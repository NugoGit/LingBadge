"""Placement catalogues: fixed, key-graded items that probe every skill without a language model.

One catalogue per skill (content/<lang>/placement/<skill>.yaml). It splits the skill's can-do
statement into exactly three facets (e.g. order / ask about a dish / pay) and holds several items
per facet. A placement run takes one item per facet, preferring items the learner has seen least,
so every run covers the whole skill and repeated runs rotate through the pool.

Item shape by mode:
  R   text  + comprehension question (choice in the instruction language, or a typed number/time)
  L   audio + the same; the app reads the script aloud (max. two plays)
  SI  context (what the other person says) + the learner's reply: choice of fitting replies,
      or a gap in the reply (type)
  SP  the learner's own line: a gap (type) or the fitting phrase (choice)
  WI  a message to write or answer: same as SI, in writing

Placement only says where to test; it never awards a badge. Productive skills are probed through
recognition and short gaps, which is an approximation of speaking and writing, not a measure.
"""
from __future__ import annotations

import random
import re
import sys

from .models import PLACEMENT_FACETS, PlacementCatalogue, Skill
from .policy import normalize

MAX_OPTIONS = 5
MIN_PER_FACET = 2
GAP = "___"


def loose(s: str) -> str:
    """normalize() plus internal punctuation and dashes ignored, for typed phrases."""
    s = re.sub(r"[,;«»\"“”„—–!?]", " ", str(s or ""))
    s = re.sub(r"\s*(uhr|год\.?|h)$", "", s.strip(), flags=re.I)
    return re.sub(r"\s+", " ", normalize(s)).strip()


def correct(item, given: str) -> bool:
    g = loose(given)
    return bool(g) and any(loose(a) == g for a in item.answer)


def validate_placement(cat: PlacementCatalogue, skills: dict[str, Skill]) -> tuple[list[str], list[str]]:
    err, warn = [], []
    p = f"placement/{cat.skill}"
    sk = skills.get(cat.skill)
    if not sk:
        return [f"{p}: unknown skill"], []
    if len(cat.facets) != PLACEMENT_FACETS:
        err.append(f"{p}: needs exactly {PLACEMENT_FACETS} facets (one item each per run), has {len(cat.facets)}")
    facets = {}
    for f in cat.facets:
        if f.id in facets:
            err.append(f"{p}: duplicate facet {f.id}")
        facets[f.id] = 0
    ids, seen = set(), set()
    for it in cat.items:
        q = f"{p}/{it.id}"
        if it.id in ids:
            err.append(f"{q}: duplicate item id")
        ids.add(it.id)
        if it.facet not in facets:
            err.append(f"{q}: unknown facet {it.facet}")
            continue
        facets[it.facet] += 1
        if sk.mode == "R" and not it.text:
            err.append(f"{q}: reading items need a text")
        if sk.mode == "L" and not it.audio:
            err.append(f"{q}: listening items need an audio script")
        if sk.mode != "L" and it.audio:
            err.append(f"{q}: audio only for listening skills")
        if sk.mode == "L" and it.text:
            err.append(f"{q}: listening items must not show the text")
        if it.stem is not None and it.stem.count(GAP) != 1:
            err.append(f"{q}: stem needs exactly one {GAP}")
        if not it.answer or not all(str(a).strip() for a in it.answer):
            err.append(f"{q}: empty answer")
            continue
        key = (loose(it.text or it.audio or ""), loose(it.context or ""), loose(it.stem or ""), str(it.prompt))
        if key in seen:
            err.append(f"{q}: duplicate item")
        seen.add(key)
        if it.format == "choice":
            opts = it.options or []
            if not 2 <= len(opts) <= MAX_OPTIONS:
                err.append(f"{q}: choice items need 2-{MAX_OPTIONS} options")
            elif len({loose(o) for o in opts}) != len(opts):
                err.append(f"{q}: duplicate options")
            elif loose(it.answer[0]) not in {loose(o) for o in opts}:
                err.append(f"{q}: answer '{it.answer[0]}' is not among the options")
            if len(it.answer) != 1:
                err.append(f"{q}: choice items have exactly one answer")
        else:
            if it.options:
                err.append(f"{q}: type items take no options")
            if sk.mode in ("SI", "SP", "WI") and it.stem is None:
                warn.append(f"{q}: productive type item without a stem; free answers are hard to key")
    for f, n in facets.items():
        if n < MIN_PER_FACET:
            err.append(f"{p}/{f}: {n} items; needs at least {MIN_PER_FACET} so repeated placements rotate")
    return err, warn


def sample(cat: PlacementCatalogue, seen: dict[str, int] | None = None, seed: int | None = None) -> list:
    """One item per facet, least-seen first, ties broken by the seeded RNG. Mirrors LB.samplePlacement."""
    r = random.Random(seed)
    seen = seen or {}
    out = []
    for f in cat.facets:
        pool = [(seen.get(it.id, 0), r.random(), it) for it in cat.items if it.facet == f.id]
        if pool:
            out.append(min(pool, key=lambda x: (x[0], x[1]))[2])
    return out


def main(argv: list[str] | None = None) -> int:
    from pathlib import Path

    from .content import load

    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("usage: python -m lingbadge.placement <lang> <skill> [seed]")
        return 2
    lang, skill = argv[0], argv[1]
    seed = int(argv[2]) if len(argv) > 2 else None
    c = load(Path(__file__).resolve().parents[2] / "content")
    cat = c.languages[lang].placement.get(skill)
    if not cat:
        print(f"no placement catalogue for {lang}/{skill}")
        return 1
    for it in sample(cat, seed=seed):
        print(f"[{it.facet}] {it.prompt if isinstance(it.prompt, str) else it.prompt.get('de')}")
        for k in ("text", "audio", "context", "stem", "cue"):
            v = getattr(it, k)
            if v:
                print(f"   {k}: {v}")
        if it.options:
            print("   options:", " | ".join(it.options))
        print("   answer:", " / ".join(it.answer))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
