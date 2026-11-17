"""Start a new language pack from templates/language-pack.

    python -m lingbadge.scaffold es Spanisch Spanish
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main(argv=None):
    argv = argv or sys.argv[1:]
    if len(argv) != 3:
        print(__doc__)
        return 2
    code, name_de, name_en = argv
    if not code.isalpha() or not code.islower() or not 2 <= len(code) <= 3:
        print("code must be an ISO 639-1/-3 code in lower case, e.g. es, pl, fa")
        return 2
    target = ROOT / "content" / code
    if target.exists():
        print(f"{target} already exists")
        return 1
    src = ROOT / "templates" / "language-pack"
    for f in sorted(src.rglob("*.yaml")):
        rel = Path(str(f.relative_to(src)).replace("{{code}}", code))
        text = f.read_text(encoding="utf-8").replace("{{code}}", code).replace("{{name_de}}", name_de).replace("{{name_en}}", name_en)
        (target / rel).parent.mkdir(parents=True, exist_ok=True)
        (target / rel).write_text(text, encoding="utf-8")
        print("created", target / rel)
    print(f"\nNext: fill the TODOs, add enablers and realizations, then run\n  python -m lingbadge.validate content reports\n"
          f"  python tools/build_app_content.py\nand open app/index.html. See docs/language-packs.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
