"""Question catalogues for enabler checks: validation, blueprint sampling, preview CLI.

A catalogue holds hand-written items for one enabler, grouped into facets (sub-rules).
Each facet has a band and a format:

  band    core       the regular rule on frequent words
          variant    regular sub-patterns that trip learners up (alternations, soft stems, -у/-ю ...)
          exception  forms that must be memorised
          contrast   choosing *when* the form applies, against a confusable neighbour

  format  choice     pick from a closed set of words; the options are the complete answer space
          type       build the form yourself (inflection, conjugation)

The sampler fills a check with a band mix (blueprint), spreads items over facets and prefers
items the learner has seen least. The web app mirrors this logic in app/core.js (sampleCheck).
"""
from __future__ import annotations

import random
import sys
from collections import defaultdict

from .models import BANDS, DEFAULT_BLUEPRINT, CheckCatalogue, Enabler
from .policy import normalize

MAX_CHOICE_OPTIONS = 5


def text(t, il: str = "de") -> str:
    if t is None:
        return ""
    if isinstance(t, str):
        return t
    return t.get(il) or t.get("en") or next(iter(t.values()), "")


def options_for(cat: CheckCatalogue, item) -> list[str] | None:
    facet = next(f for f in cat.facets if f.id == item.facet)
    return item.options or facet.options


def validate_catalogue(cat: CheckCatalogue, enablers: dict[str, Enabler]) -> tuple[list[str], list[str]]:
    err, warn = [], []
    p = f"checks/{cat.enabler}"
    en = enablers.get(cat.enabler)
    if not en:
        return [f"{p}: unknown enabler"], []
    if not cat.enabler.startswith(cat.lang + "."):
        err.append(f"{p}: lang {cat.lang} does not match the enabler id")
    facets = {}
    for f in cat.facets:
        if f.id in facets:
            err.append(f"{p}: duplicate facet {f.id}")
        facets[f.id] = f
        if f.format == "choice" and f.options is not None and not 2 <= len(f.options) <= MAX_CHOICE_OPTIONS:
            err.append(f"{p}/{f.id}: choice facets need 2-{MAX_CHOICE_OPTIONS} options")
        if f.format == "type" and f.options:
            err.append(f"{p}/{f.id}: type facets take no options (the learner builds the form)")
    ids, stems = set(), set()
    per_band = defaultdict(int)
    for it in cat.items:
        q = f"{p}/{it.id}"
        if it.id in ids:
            err.append(f"{q}: duplicate item id")
        ids.add(it.id)
        f = facets.get(it.facet)
        if not f:
            err.append(f"{q}: unknown facet {it.facet}")
            continue
        per_band[f.band] += 1
        if it.stem.count("___") != 1:
            err.append(f"{q}: stem needs exactly one ___")
        key = (normalize(it.stem), normalize(it.cue or ""), tuple(normalize(o) for o in (it.options or [])))
        if key in stems:
            err.append(f"{q}: duplicate stem")
        stems.add(key)
        if not it.answer or not all(str(a).strip() for a in it.answer):
            err.append(f"{q}: empty answer")
        if f.format == "choice":
            opts = it.options or f.options
            if not opts:
                err.append(f"{q}: choice item without options")
            elif not 2 <= len(opts) <= MAX_CHOICE_OPTIONS:
                err.append(f"{q}: choice items need 2-{MAX_CHOICE_OPTIONS} options")
            elif normalize(it.answer[0]) not in {normalize(o) for o in opts}:
                err.append(f"{q}: answer '{it.answer[0]}' is not among the options")
            if it.cue:
                warn.append(f"{q}: cue on a choice item is usually a give-away")
        else:
            if it.options:
                err.append(f"{q}: type items take no options")
            if not it.cue and f.band != "contrast":
                warn.append(f"{q}: type item without cue (base form)")
    n = en.check.items
    if len(cat.items) < 2 * n:
        warn.append(f"{p}: {len(cat.items)} items; aim for at least {2 * n} so two checks in a row rarely repeat")
    bp = cat.blueprint or DEFAULT_BLUEPRINT
    q = quotas(n, dict(per_band), bp)
    for b, k in q.items():
        if per_band[b] < 2 * k:
            warn.append(f"{p}: band {b} has {per_band[b]} items for a quota of {k}; add more for variety")
    return err, warn


def quotas(n: int, available: dict[str, int], weights: dict[str, float] | None = None) -> dict[str, int]:
    """How many items per band. Every band with items gets one if n allows; the rest follows the weights."""
    weights = weights or DEFAULT_BLUEPRINT
    bands = [b for b in BANDS if available.get(b)]
    if not bands:
        return {}
    w = {b: float(weights.get(b, 0)) for b in bands}
    tot = sum(w.values()) or len(bands)
    w = {b: (w[b] / tot if sum(w.values()) else 1 / len(bands)) for b in bands}
    q = {b: 0 for b in bands}
    if n >= len(bands):
        for b in bands:
            q[b] = 1
    left = n - sum(q.values())
    while left > 0:
        open_ = [b for b in bands if q[b] < available[b]]
        if not open_:
            break
        b = max(open_, key=lambda x: (w[x] * n - q[x], -BANDS.index(x)))
        q[b] += 1
        left -= 1
    return q


def sample(cat: CheckCatalogue, n: int, seen: dict[str, int] | None = None, seed: int | None = None) -> list:
    rng = random.Random(seed)
    seen = seen or {}
    facets = {f.id: f for f in cat.facets}
    by_band: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for it in cat.items:
        by_band[facets[it.facet].band][it.facet].append(it)
    q = quotas(n, {b: sum(len(v) for v in fs.values()) for b, fs in by_band.items()}, cat.blueprint)
    picked = []
    for b, k in q.items():
        groups = []
        for fid, items in by_band[b].items():
            items = sorted(items, key=lambda it: (seen.get(it.id, 0), rng.random()))
            groups.append(items)
        rng.shuffle(groups)
        groups.sort(key=lambda g: seen.get(g[0].id, 0))  # facets with unseen items first, stable after shuffle
        i = 0
        while k > 0 and any(groups):
            g = groups[i % len(groups)]
            if g:
                picked.append(g.pop(0))
                k -= 1
            i += 1
    rng.shuffle(picked)
    return picked


def main(argv=None):
    """python -m lingbadge.checks <enabler-id> [seed]  — print one sampled check for review."""
    from pathlib import Path

    from .content import load
    argv = argv or sys.argv[1:]
    if not argv:
        print(main.__doc__)
        return 2
    eid, seed = argv[0], int(argv[1]) if len(argv) > 1 else None
    c = load(Path("content"))
    lang = c.languages[eid.split(".")[0]]
    cat, en = lang.checks.get(eid), lang.enablers[eid]
    if not cat:
        print(f"no catalogue for {eid}")
        return 1
    facets = {f.id: f for f in cat.facets}
    for i, it in enumerate(sample(cat, en.check.items, seed=seed), 1):
        f = facets[it.facet]
        opts = options_for(cat, it)
        cue = f" ({it.cue})" if it.cue else ""
        ctx = f"[{text(it.context)}] " if it.context else ""
        print(f"{i:2}. [{f.band}/{f.id}] {ctx}{it.stem}{cue}" + (f"   {' | '.join(opts)}" if f.format == "choice" else "")
              + f"   → {' / '.join(it.answer)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
