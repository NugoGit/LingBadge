"""Bundle content/ into app/content.json for the web app (Ukrainian only for now)."""
import json, sys
from pathlib import Path
import yaml
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from lingobadge.content import load

ROOT = Path(__file__).resolve().parents[1]
c = load(ROOT / "content")
uk = c.languages["uk"]
theme_order = [t.id for t in c.themes.values()]
out = {
    "version": "stage4-1",
    "themes": [dict(id=t.id, title=t.title, situations=[dict(id=s.id, title=s.title) for s in t.situations]) for t in c.themes.values() if t.situations],
    "skills": [dict(id=s.id, task=s.task, theme=s.theme, situation=s.situation, title=s.title, can_do=s.can_do, mode=s.mode,
                    cefr=s.cefr, size=s.size, prerequisites=s.prerequisites, rubric=s.rubric, threshold=s.threshold, flags=s.flags)
               for s in sorted(c.skills.values(), key=lambda s: (theme_order.index(s.theme), s.id))],
    "enablers": {e.id: dict(id=e.id, kind=e.kind, title=e.title, cefr=e.cefr, requires=e.requires, channel=e.check.channel,
                            words=e.words) for e in uk.enablers.values()},
    "realizations": {k: dict(registers=r.registers, variety=r.variety, exponents=r.exponents, cefr=r.cefr, size=r.size,
                             enablers=[dict(id=u.id, use=u.use, role="required") for u in r.enablers.required]
                                     + [dict(id=u.id, use=u.use, role="supporting") for u in r.enablers.supporting],
                             key_structures=(r.rubric_specifics or {}).get("key_structures"), note=r.note)
                     for k, r in uk.realizations.items()},
    "rubrics": {k: r.model_dump() for k, r in c.rubrics.items()},
    "templates": {t["id"]: t for t in yaml.safe_load((ROOT / "content/core/templates.yaml").read_text())["templates"]},
    "mastery": yaml.safe_load((ROOT / "config/mastery.yaml").read_text()),
}
(ROOT / "app/content.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("app/content.json", len(json.dumps(out, ensure_ascii=False)) // 1024, "KB")
