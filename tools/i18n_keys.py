"""List the German UI strings the app translates (t("…") calls and the label tables), for app/i18n.js."""
import json, re, sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "app" / "app.js"
TABLES = ["MODE_DE", "ST_DE", "KIND_DE", "BAND_DE", "BAND_HINT", "CRIT_DE0", "LEVEL_DE0"]


def keys(src: str) -> list[str]:
    out = []
    for m in re.finditer(r"(?<![\w.$])t\(", src):
        i, depth, j = m.end(), 1, m.end()
        while depth and j < len(src):
            depth += {"(": 1, ")": -1}.get(src[j], 0)
            j += 1
        out += [s for s in re.findall(r'"((?:[^"\\]|\\.)*)"', src[i:j - 1]) if re.search(r"[A-Za-zÄÖÜäöü]{2}", s)]
    for name in TABLES:
        m = re.search(name + r"[^=]*=\s*(?:new Proxy\(|tProxy\()?(\{[^}]*\}|\[[^\]]*\])", src)
        out += re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
    m = re.search(r'\[\["badge", "Abzeichen"\].*?\]\]', src, re.S)
    out += re.findall(r'"([^"]+)"\]', m.group(0))
    out += re.findall(r'(?:karte|einstufung|grammatik|einstellungen): "([^"]+)"', src)
    seen, res = set(), []
    for k in out:
        k = k.encode().decode("unicode_escape").encode("latin-1").decode("utf-8") if "\\u" in k else k
        if k not in seen and not re.fullmatch(r"#\w+|SP|SI|mcq|gap_fill|catalogue|default|complex|browser|claude|anthropic|openai|none|tts|learner|interlocutor|interaction|written|formulaic|badge|probe|check|standalone", k):
            seen.add(k); res.append(k)
    return res


if __name__ == "__main__":
    ks = keys(SRC.read_text(encoding="utf-8"))
    if "--json" in sys.argv:
        print(json.dumps(ks, ensure_ascii=False, indent=0))
    else:
        print(len(ks)); print("\n".join(ks))
