"""Dump examples/*.yaml as one JSON object (input for tests/core.test.js)."""
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
out = {f.name: yaml.safe_load(f.read_text(encoding="utf-8")) for f in sorted((ROOT / "examples").glob("*.yaml"))}
json.dump(out, sys.stdout, ensure_ascii=False, default=str)
