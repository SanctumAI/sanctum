#!/usr/bin/env python3
"""
i18n audit for the frontend.

What it checks:
- Translation keys used via t('...') / i18n.t('...') exist in locale JSON files.
- Pluralization: if code uses key 'x.y', presence of 'x.y_one', 'x.y_other', etc counts as present.
- Keys missing from en.json (highest priority).
- Keys present in en.json but missing from other locales.
- Non-literal t(...) calls (manual review).
- Obvious hardcoded UI strings in TSX attributes (manual review).

Usage:
  python3 scripts/i18n_audit.py
  python3 scripts/i18n_audit.py --json docs/i18n-audit.json
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
LOCALES_DIR = FRONTEND_SRC / "i18n" / "locales"

PLURAL_SUFFIXES = ("_zero", "_one", "_two", "_few", "_many", "_other")


def flatten_json(obj: Any, prefix: str = "") -> Dict[str, Any]:
  out: Dict[str, Any] = {}
  if isinstance(obj, dict):
    for k, v in obj.items():
      key = f"{prefix}.{k}" if prefix else str(k)
      out.update(flatten_json(v, key))
    return out
  out[prefix] = obj
  return out


def locale_key_present(locale_keys: Set[str], key: str) -> bool:
  if key in locale_keys:
    return True
  for suf in PLURAL_SUFFIXES:
    if f"{key}{suf}" in locale_keys:
      return True
  return False


@dataclass(frozen=True)
class Location:
  file: str
  line: int
  col: int


def iter_frontend_files(root: Path) -> Iterable[Path]:
  for ext in ("*.ts", "*.tsx"):
    yield from root.rglob(ext)


def line_col_from_offset(text: str, offset: int) -> Tuple[int, int]:
  # 1-based line/col
  line = text.count("\n", 0, offset) + 1
  last_nl = text.rfind("\n", 0, offset)
  if last_nl == -1:
    col = offset + 1
  else:
    col = offset - last_nl
  return line, col


def extract_literal_t_keys_and_locations(files: Iterable[Path]) -> Tuple[Set[str], Dict[str, List[Location]]]:
  # Matches: t('a.b'), i18n.t("a.b")
  key_re = re.compile(r"\b(?:i18n\.)?t\(\s*(['\"])(.+?)\1")

  keys: Set[str] = set()
  locs: Dict[str, List[Location]] = {}
  for p in files:
    try:
      text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
      continue
    for m in key_re.finditer(text):
      key = m.group(2)
      keys.add(key)
      line, col = line_col_from_offset(text, m.start(2))
      locs.setdefault(key, []).append(Location(str(p.relative_to(REPO_ROOT)), line, col))
  return keys, locs


def extract_nonliteral_t_calls(files: Iterable[Path]) -> List[Location]:
  # Heuristic: t(someVar) or t(error.message) etc. Skips strings, template strings, objects, arrays.
  nonlit_re = re.compile(r"\b(?:i18n\.)?t\(\s*([^'\"\s`{\[][^,)]*)")
  locs: List[Location] = []
  for p in files:
    try:
      text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
      continue
    for m in nonlit_re.finditer(text):
      arg = m.group(1).strip()
      line, col = line_col_from_offset(text, m.start(1))
      locs.append(Location(f"{p.relative_to(REPO_ROOT)} (arg: {arg})", line, col))
  # De-dupe exact locations
  seen = set()
  out: List[Location] = []
  for l in locs:
    key = (l.file, l.line, l.col)
    if key in seen:
      continue
    seen.add(key)
    out.append(l)
  return out


def extract_hardcoded_tsx_attributes(files: Iterable[Path]) -> List[Dict[str, Any]]:
  # Focus only on a small set of user-facing attributes to keep signal reasonable.
  # This intentionally does not attempt to parse JSX.
  attrs = ("placeholder", "title", "aria-label", "alt", "label", "helperText")
  # attribute="..."
  attr_re = re.compile(rf"\b({'|'.join(map(re.escape, attrs))})=\"([^\"]+)\"")
  out: List[Dict[str, Any]] = []
  for p in files:
    if p.suffix != ".tsx":
      continue
    try:
      text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
      continue
    for m in attr_re.finditer(text):
      attr = m.group(1)
      value = m.group(2)
      # skip empty / obviously non-copy values
      if not value.strip():
        continue
      line, col = line_col_from_offset(text, m.start(2))
      out.append(
        {
          "file": str(p.relative_to(REPO_ROOT)),
          "line": line,
          "col": col,
          "attr": attr,
          "value": value,
        }
      )
  return out


def load_locales(locales_dir: Path) -> Dict[str, Set[str]]:
  locales: Dict[str, Set[str]] = {}
  for p in sorted(locales_dir.glob("*.json")):
    lang = p.stem
    data = json.loads(p.read_text(encoding="utf-8"))
    locales[lang] = set(flatten_json(data).keys())
  return locales


def main() -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--json", dest="json_path", type=str, default=None, help="Write full report to this path")
  args = ap.parse_args()

  if not LOCALES_DIR.exists():
    raise SystemExit(f"Locales dir not found: {LOCALES_DIR}")

  locale_keys = load_locales(LOCALES_DIR)
  langs = sorted(locale_keys.keys())

  files = list(iter_frontend_files(FRONTEND_SRC))
  used_keys, used_key_locs = extract_literal_t_keys_and_locations(files)
  nonliteral_calls = extract_nonliteral_t_calls(files)
  hardcoded_attrs = extract_hardcoded_tsx_attributes(files)

  # Prefer a TypeScript-AST based extractor for hardcoded UI copy (more accurate than regex).
  hardcoded_copy: List[Dict[str, Any]] = []
  hardcoded_copy_error: Optional[str] = None
  try:
    out = subprocess.check_output(
      ["node", "../scripts/i18n_extract_hardcoded_copy.mjs"],
      cwd=str(REPO_ROOT / "frontend"),
      text=True,
    )
    hardcoded_copy = json.loads(out)
  except Exception as e:
    hardcoded_copy_error = str(e)

  def missing_in_lang(lang: str, key: str) -> bool:
    return not locale_key_present(locale_keys[lang], key)

  missing_in_en = sorted([k for k in used_keys if missing_in_lang("en", k)])

  # For keys that are present in en (plural-aware), track which locales are missing them.
  present_in_en = [k for k in used_keys if not missing_in_lang("en", k)]
  missing_by_locale: Dict[str, List[str]] = {}
  for lang in langs:
    missing_by_locale[lang] = sorted([k for k in used_keys if missing_in_lang(lang, k)])

  missing_some_locale_but_present_in_en: Dict[str, List[str]] = {}
  for k in sorted(present_in_en):
    missing_langs = [lang for lang in langs if missing_in_lang(lang, k)]
    if missing_langs:
      missing_some_locale_but_present_in_en[k] = missing_langs

  # Key -> locations only for missing-in-en (highest value to fix)
  missing_in_en_locations = {
    k: [loc.__dict__ for loc in used_key_locs.get(k, [])] for k in missing_in_en
  }

  report: Dict[str, Any] = {
    "summary": {
      "languages": langs,
      "locale_leaf_key_counts": {lang: len(keys) for lang, keys in locale_keys.items()},
      "used_keys_count": len(used_keys),
      "missing_in_en_count": len(missing_in_en),
      "missing_used_keys_count_by_locale": {lang: len(missing_by_locale[lang]) for lang in langs},
      "missing_some_locale_but_present_in_en_count": len(missing_some_locale_but_present_in_en),
      "nonliteral_t_call_count": len(nonliteral_calls),
      "hardcoded_tsx_attribute_string_count": len(hardcoded_attrs),
      "hardcoded_copy_count": len(hardcoded_copy),
      "hardcoded_copy_error": hardcoded_copy_error,
    },
    "missing_in_en": missing_in_en,
    "missing_in_en_locations": missing_in_en_locations,
    "missing_used_keys_by_locale": missing_by_locale,
    "missing_some_locale_but_present_in_en": missing_some_locale_but_present_in_en,
    "nonliteral_t_calls": [loc.__dict__ for loc in nonliteral_calls],
    "hardcoded_tsx_attribute_strings": hardcoded_attrs,
    "hardcoded_copy": hardcoded_copy,
  }

  print("i18n audit summary")
  print(f"- languages: {len(langs)} ({', '.join(langs)})")
  print(f"- used keys: {len(used_keys)}")
  print(f"- missing in en: {len(missing_in_en)}")
  print(f"- keys present in en but missing in >=1 locale: {len(missing_some_locale_but_present_in_en)}")
  # Show the worst locales for used-key coverage (plural-aware)
  worst = sorted(
    ((lang, len(missing_by_locale[lang])) for lang in langs),
    key=lambda x: x[1],
    reverse=True,
  )[:8]
  print("- missing used keys by locale (worst 8):")
  for lang, n in worst:
    print(f"  - {lang}: {n}")
  print(f"- non-literal t(...) calls: {len(nonliteral_calls)}")
  print(f"- hardcoded TSX attribute strings: {len(hardcoded_attrs)}")
  if hardcoded_copy_error:
    print(f"- hardcoded UI copy (AST extractor): unavailable ({hardcoded_copy_error})")
  else:
    print(f"- hardcoded UI copy (AST extractor): {len(hardcoded_copy)}")

  if args.json_path:
    out_path = (REPO_ROOT / args.json_path).resolve() if not Path(args.json_path).is_absolute() else Path(args.json_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"- wrote report: {out_path}")

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
