# Integration Tests

This document describes the integration test suite located in `scripts/tests/`.

---

## Directory Structure

```
scripts/tests/
├── run_all_be_tests.py     # Master test runner
├── CRM/                    # User data encryption tests (1x)
│   ├── test-config.json    # Test fixtures and constants
│   ├── test_1a_verify_encryption.py
│   └── test_1b_decrypt_fidelity.py
└── RAG/                    # Document ingestion persistence tests (2x)
    ├── test-config.json    # Test fixtures and constants
    └── test_2a_document_persistence.py
```

---

## Test Naming Convention

Tests follow a structured naming pattern:

```
test_{number}{letter}_{description}.py
```

| Component | Description | Example |
|-----------|-------------|---------|
| `test_` | Required prefix for test discovery | `test_` |
| `{number}` | Domain category (1=CRM, 2=RAG, 3=AUTH...) | `1`, `2` |
| `{letter}` | Sequential test within domain (a, b, c...) | `a`, `b` |
| `{description}` | Brief description | `verify_encryption`, `document_persistence` |

### Domain Numbers

| Number | Domain | Description |
|--------|--------|-------------|
| 1 | CRM | User data, encryption, PII handling |
| 2 | RAG | Document ingestion, retrieval, persistence |
| 3 | AUTH | Authentication flows (reserved) |
| 4 | TOOLS | Tool orchestration (reserved) |

### Current Tests

| Test ID | File | Domain | Description |
|---------|------|--------|-------------|
| 1A | `test_1a_verify_encryption.py` | CRM | Verify NIP-04 encryption in DB |
| 1B | `test_1b_decrypt_fidelity.py` | CRM | Decrypt and verify data fidelity |
| 2A | `test_2a_document_persistence.py` | RAG | Document ingestion and persistence |
| 2B | (planned) | RAG | RAG query retrieval accuracy |

---

## Test Configurations

Each subdirectory contains a `test-config.json` with:

### CRM/test-config.json

```json
{
  "test_admin": {
    "private_key_hex": "...",  // For encryption/decryption
    "public_key_hex": "..."    // Admin pubkey
  },
  "test_user": {
    "email": "...",
    "name": "...",
    "fields": { ... }
  },
  "expected_behavior": { ... }
}
```

### RAG/test-config.json

```json
{
  "test_document": {
    "filename": "...",
    "title": "...",
    "content": "..."  // Will be converted to PDF
  },
  "expected_entities": [...],
  "test_queries": [...]
}
```

---

## Running Tests

### Prerequisites

```bash
pip install requests reportlab coincurve pycryptodome
```

Ensure backend is running:
```bash
docker compose up --build
```

### Run All Tests

```bash
cd scripts/tests
python run_all_be_tests.py
```

Options:
```bash
# Specify API base URL
python run_all_be_tests.py --api-base http://localhost:8000

# Verbose output
python run_all_be_tests.py --verbose

# Run all CRM tests (1x)
python run_all_be_tests.py --pattern "test_1*"

# Run specific test (2A)
python run_all_be_tests.py --pattern "test_2a_*"
```

### Run Individual Tests

```bash
# CRM encryption test (1A)
cd scripts/tests/CRM
python test_1a_verify_encryption.py --api-base http://localhost:8000

# RAG persistence test (2A)
cd scripts/tests/RAG
python test_2a_document_persistence.py --api-base http://localhost:8000
```

---

## Expected Results

### Test 1A: Verify Encryption

✅ **PASS** when:
- `users.email` and `users.name` columns are NULL
- `encrypted_email` / `encrypted_name` contain NIP-04 ciphertext
- `email_blind_index` is 64-char hex
- Decrypted values match original input

### Test 2A: Document Persistence

✅ **PASS** when:
- PDF generated from config content
- Upload succeeds via `/ingest/upload`
- Job appears in `/ingest/jobs` (SQLite persistence)
- Job persists after `docker compose down && up`

---

## Adding New Tests

1. Create subdirectory if new domain: `scripts/tests/{DOMAIN}/`
2. Create `test-config.json` with test fixtures
3. Create test file: `test_{number}{letter}_{description}.py`
4. Implement with this structure:

```python
#!/usr/bin/env python3
"""
Test {Number}{Letter}: Description

Tests specific behavior...
"""

import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

def load_config() -> dict:
    config_path = SCRIPT_DIR / "test-config.json"
    with open(config_path) as f:
        return json.load(f)

def test_main(api_base: str, config: dict, **kwargs) -> bool:
    """Main test logic. Returns True if passed."""
    # ... test implementation ...
    return passed

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="http://localhost:8000")
    args = parser.parse_args()
    
    config = load_config()
    passed = test_main(args.api_base, config)
    
    import sys
    sys.exit(0 if passed else 1)

if __name__ == "__main__":
    main()
```

The test runner (`run_all_be_tests.py`) will auto-discover any file matching `test_*.py`.

---

## Troubleshooting

### "reportlab not installed"
```bash
pip install reportlab
```

### "No admin configured for encryption"
Register as admin via frontend before running CRM tests.

### "Job not found after restart"
SQLite persistence issue - check if `ingest_jobs` table has data:
```bash
docker compose exec backend sqlite3 /data/sanctum.db "SELECT * FROM ingest_jobs"
```

### Authentication errors
Provide token via `--token` argument or ensure admin is set up.
