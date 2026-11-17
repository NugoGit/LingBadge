"""Turn error tags into a ranked list of likely holes and the checks to take next."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .content import Language
from .forms import Grade, TestForm

WEAK = {"unknown", "shaky", "untested"}


@dataclass
class Hole:
    enabler: str
    title: str
    cefr: str
    errors: int
    examples: list[str]
    check_first: list[str] = field(default_factory=list)   # weak ancestors, deepest first, then the enabler itself


@dataclass
class Diagnosis:
    holes: list[Hole]
    chunks: list[str]          # broken memorised phrases: practise as phrases, no grammar check implied
    unlisted: list[str]        # errors the realization did not anticipate: content to fix


def _weak_ancestors(enabler: str, lang: Language, status: dict[str, str]) -> list[str]:
    out, seen = [], set()

    def walk(e):
        for r in lang.enablers[e].requires if e in lang.enablers else []:
            if r in seen:
                continue
            seen.add(r)
            walk(r)
            if status.get(r, "untested") in WEAK:
                out.append(r)
    walk(enabler)
    return out


def diagnose(form: TestForm, grade: Grade, lang: Language, status: dict[str, str] | None = None) -> Diagnosis:
    status = status or {}
    by_enabler, examples = Counter(), {}
    for e in grade.errors:
        if e.enabler and not e.enabler.startswith("unlisted"):
            by_enabler[e.enabler] += 1
            examples.setdefault(e.enabler, []).append(f"{e.span} → {e.correction}")
    # keyed items: a wrong item counts once for each enabler it tests
    item_enablers = {i.id: i.enablers for i in form.items}
    for item_id, ok in grade.item_results.items():
        if not ok:
            for en in item_enablers.get(item_id, []):
                by_enabler[en] += 1
                examples.setdefault(en, []).append(f"item {item_id}")
    holes = []
    for en, n in by_enabler.most_common():
        meta = lang.enablers.get(en)
        holes.append(Hole(en, meta.title if meta else en, meta.cefr if meta else "?", n, examples[en][:3],
                          _weak_ancestors(en, lang, status) + [en]))
    chunks = sorted({e.chunk for e in grade.errors if e.chunk})
    unlisted = [f"{e.span}: {e.enabler}" for e in grade.errors if e.enabler and e.enabler.startswith("unlisted")]
    return Diagnosis(holes, chunks, unlisted)
