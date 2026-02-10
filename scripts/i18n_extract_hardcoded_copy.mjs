#!/usr/bin/env node
// Run from `frontend/` so Node can resolve `typescript` from `frontend/node_modules`.
// Outputs JSON to stdout: [{ file, line, col, kind, ... }]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const CWD = process.cwd(); // expected: .../sanctum/frontend
const FRONTEND_SRC = path.join(CWD, 'src');
const REPO_ROOT = path.resolve(CWD, '..');

// Resolve `typescript` from the frontend install (cwd), not from this script's location.
const requireFromCwd = createRequire(path.join(CWD, 'package.json'));
const ts = requireFromCwd('typescript');

const ATTR_WHITELIST = new Set([
  'placeholder',
  'title',
  'aria-label',
  'alt',
  'label',
  'helperText',
]);

function listFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(full));
    else if (ent.isFile() && full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function looksLikeCopy(s) {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return false;
  // Must contain at least one letter.
  if (!/[A-Za-z]/.test(t)) return false;
  // Ignore tokens that look like identifiers/paths/env vars.
  if (/^[A-Za-z0-9_./:+-]+$/.test(t)) return false;
  return true;
}

function main() {
  const files = listFiles(FRONTEND_SRC);
  const results = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function add(pos, payload) {
      const lc = sf.getLineAndCharacterOfPosition(pos);
      results.push({
        file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
        line: lc.line + 1,
        col: lc.character + 1,
        ...payload,
      });
    }

    function visit(node) {
      if (ts.isJsxText(node)) {
        const text = node.getText(sf);
        const trimmed = text.trim().replace(/\s+/g, ' ');
        if (looksLikeCopy(trimmed)) {
          // Position at first non-whitespace char inside this node.
          const raw = node.getText(sf);
          const i = raw.search(/\S/);
          const pos = i >= 0 ? node.getStart(sf) + i : node.getStart(sf);
          add(pos, { kind: 'jsxText', text: trimmed });
        }
      }

      if (ts.isJsxAttribute(node)) {
        const name = node.name?.getText(sf);
        if (name && ATTR_WHITELIST.has(name)) {
          const init = node.initializer;
          if (init && ts.isStringLiteral(init)) {
            const value = init.text;
            if (looksLikeCopy(value)) {
              add(init.getStart(sf) + 1, { kind: 'jsxAttr', attr: name, value });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  process.stdout.write(JSON.stringify(results, null, 2));
  process.stdout.write('\n');
}

main();
