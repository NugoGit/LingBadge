"""Validate the content tree and write trace, coverage and overview reports.

Usage: python -m lingbadge.validate [content_dir] [reports_dir]
Exit code 1 if there are errors.
"""
from __future__ import annotations

import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

from .checks import validate_catalogue
from .placement import validate_placement
from .content import Content, load
from .models import CEFR_ORDER, MVP_BADGE_MODES

MODES = ["R", "L", "SI", "SP", "WI", "WP"]
DOMAINS = ["personal", "public", "occupational", "educational"]


def find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    stack: list[str] = []

    def visit(n):
        color[n] = GREY
        stack.append(n)
        for m in graph.get(n, []):
            if color.get(m) == GREY:
                return stack[stack.index(m):] + [m]
            if color.get(m) == WHITE:
                c = visit(m)
                if c:
                    return c
        stack.pop()
        color[n] = BLACK
        return None

    for n in graph:
        if color[n] == WHITE:
            c = visit(n)
            if c:
                return c
    return None


def lvl(c: str) -> int:
    return CEFR_ORDER.index(c)


I18N_ROOT = Path(__file__).resolve().parents[2] / "content"


def _yaml_or_empty(path: Path) -> dict:
    import yaml
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.exists() else {}


def check(c: Content) -> tuple[list[str], list[str]]:
    err, warn = list(c.errors), []
    srcs = c.all_sources()
    sit = c.situations
    for s in c.skills.values():
        for p in s.prerequisites + s.recommended_before:
            if p not in c.skills:
                err.append(f"{s.id}: unknown skill reference {p}")
            elif p in s.prerequisites and lvl(c.skills[p].cefr) > lvl(s.cefr):
                err.append(f"{s.id}: prerequisite {p} has a higher CEFR level")
        if s.situation not in sit:
            err.append(f"{s.id}: unknown situation {s.situation}")
        elif sit[s.situation] != s.theme:
            err.append(f"{s.id}: situation {s.situation} belongs to theme {sit[s.situation]}")
        if not s.task.startswith(s.theme + ".") or s.id != f"{s.task}.{s.mode}":
            err.append(f"{s.id}: id must be <task>.<mode> and task must start with the theme")
        for x in s.sources:
            if x not in srcs:
                err.append(f"{s.id}: unknown source {x}")
        if s.rubric not in c.rubrics:
            err.append(f"{s.id}: unknown rubric {s.rubric}")
    cyc = find_cycle({k: v.prerequisites for k, v in c.skills.items()})
    if cyc:
        err.append("skill prerequisite cycle: " + " -> ".join(cyc))

    de = _yaml_or_empty(I18N_ROOT / "core" / "i18n" / "de.yaml")
    for kind, ids in (("themes", {t.id for t in c.themes.values()}), ("skills", set(c.skills))):
        known = de.get(kind, {})
        for x in sorted(set(known) - ids):
            err.append(f"i18n/de: unknown {kind[:-1]} {x}")
        if kind == "skills":
            for x, v in known.items():
                if not isinstance(v, dict) or set(v) != {"title", "can_do"}:
                    err.append(f"i18n/de: skill {x} needs exactly title and can_do (quote values that contain commas)")
        missing = sorted(ids - set(known))
        if missing and de:
            warn.append(f"i18n/de: {len(missing)} {kind} without a German title: {', '.join(missing[:8])}")

    for code, lang in c.languages.items():
        de_lang = _yaml_or_empty(I18N_ROOT / code / "i18n" / "de.yaml").get("enablers", {})
        for x in sorted(set(de_lang) - set(lang.enablers)):
            err.append(f"{code}/i18n/de: unknown enabler {x}")
        no_de = sorted(set(lang.enablers) - set(de_lang))
        if no_de and de_lang:
            warn.append(f"{code}: {len(no_de)} enablers without a German title: {', '.join(no_de[:8])}")
        for e in lang.enablers.values():
            if not e.id.startswith(code + "."):
                err.append(f"{e.id}: enabler id must start with '{code}.'")
            for r in e.requires:
                if r not in lang.enablers:
                    err.append(f"{e.id}: unknown required enabler {r}")
                elif lvl(lang.enablers[r].cefr) > lvl(e.cefr):
                    err.append(f"{e.id}: requires higher-level enabler {r}")
            for x in e.sources:
                if x not in srcs:
                    err.append(f"{e.id}: unknown source {x}")
        cyc = find_cycle({k: v.requires for k, v in lang.enablers.items()})
        if cyc:
            err.append(f"{code}: enabler cycle: " + " -> ".join(cyc))
        used = set()
        for r in lang.realizations.values():
            if r.skill not in c.skills:
                err.append(f"{code}/{r.skill}: realization for unknown skill")
                continue
            for u in r.enablers.required + r.enablers.supporting:
                e = lang.enablers.get(u.id)
                if not e:
                    err.append(f"{code}/{r.skill}: unknown enabler {u.id}")
                    continue
                used.add(u.id)
                if u.use == "productive" and lvl(e.cefr) > lvl(r.cefr):
                    err.append(f"{code}/{r.skill}: productive use of {e.cefr} enabler {u.id} in an {r.cefr} realization "
                               f"(mark it formulaic or raise the level)")
        frontier = list(used)
        while frontier:  # an enabler counts as used if a used enabler builds on it
            current = lang.enablers.get(frontier.pop())
            for r in (current.requires if current else []):
                if r in lang.enablers and r not in used:
                    used.add(r)
                    frontier.append(r)
        for e in lang.enablers.values():
            if e.id not in used and lvl(e.cefr) <= lvl("A1"):
                warn.append(f"{e.id}: A1 enabler not used by any {code} realization")
        for cat in lang.checks.values():
            e2, w2 = validate_catalogue(cat, lang.enablers)
            err += e2
            warn += w2
        no_cat = sorted(e.id for e in lang.enablers.values()
                        if e.check.channel == "text" and e.kind != "lexis" and e.id not in lang.checks and lvl(e.cefr) <= lvl("A1"))
        if no_cat and lang.checks:
            warn.append(f"{code}: {len(no_cat)} A1 enablers without a question catalogue (checks fall back to generated items): "
                        + ", ".join(no_cat))
        for cat in lang.placement.values():
            if cat.lang != code:
                err.append(f"placement/{cat.skill}: lang {cat.lang} in the {code} folder")
            e2, w2 = validate_placement(cat, c.skills)
            err += e2
            warn += w2
        no_pl = sorted(s for s in lang.realizations if s not in lang.placement)
        if no_pl and lang.placement:
            warn.append(f"{code}: {len(no_pl)} skills without a placement catalogue (placement falls back to generated items): "
                        + ", ".join(no_pl))
        missing = sorted(set(c.skills) - set(lang.realizations))
        if missing and len(missing) < len(c.skills) / 2:
            warn.append(f"{code}: {len(missing)} skills without realization: {', '.join(missing)}")
    for s in c.skills.values():
        if s.mode in MVP_BADGE_MODES:
            blocked = [p for p in s.prerequisites if c.skills.get(p) and c.skills[p].mode not in MVP_BADGE_MODES]
            if blocked:
                warn.append(f"{s.id}: prerequisite(s) {blocked} cannot be certified in the text-only MVP")
    return err, warn


def trace_report(c: Content) -> str:
    srcs = c.all_sources()
    by_source = defaultdict(list)
    for s in c.skills.values():
        for x in s.sources:
            by_source[x].append(s.id)
    lines = ["# Trace report", "",
             "Two-way trace between sources and A1 skills. A source with no skill is a gap unless it is deferred with a reason.", ""]

    def section(title, origin, prefix=""):
        rows = [x for x in srcs.values() if x.origin == origin and x.id.startswith(prefix)]
        mapped = [x for x in rows if by_source.get(x.id)]
        deferred = [x for x in rows if not by_source.get(x.id) and x.deferred]
        gaps = [x for x in rows if not by_source.get(x.id) and not x.deferred]
        lines.extend([f"## {title}", "",
                      f"{len(mapped)} of {len(rows)} mapped · {len(deferred)} deferred · **{len(gaps)} gaps**", "",
                      "| Source | Paraphrase | Skills |", "| --- | --- | --- |"])
        for x in rows:
            sk = ", ".join(f"`{i}`" for i in by_source.get(x.id, [])) or (f"deferred: {x.deferred}" if x.deferred else "**GAP**")
            lines.append(f"| `{x.id}` | {x.text} | {sk} |")
        lines.append("")

    section("CEFR Companion Volume, A1 descriptors", "cefr-cv")
    section("Ukrainian standard, A1 intentions (Catalogue A)", "ukstd", "ukstd.A1.intent")
    section("Ukrainian standard, A1 themes (Catalogue B)", "ukstd", "ukstd.A1.theme")

    # grammar -> enablers -> realizations
    uk = c.languages.get("uk")
    if uk:
        lines.extend(["## Ukrainian standard grammar (Catalogue C) → enablers → skills", "",
                      "| Grammar point | Level | Enablers | Used productively in | Used as chunk in |",
                      "| --- | --- | --- | --- | --- |"])
        prod, form = defaultdict(set), defaultdict(set)
        for r in uk.realizations.values():
            for u in r.enablers.required + r.enablers.supporting:
                (prod if u.use == "productive" else form)[u.id].add(r.skill)
        for x in uk.sources.values():
            ens = [e.id for e in uk.enablers.values() if x.id in e.sources]
            p = sorted({s for e in ens for s in prod[e]})
            f = sorted({s for e in ens for s in form[e]})
            level = x.id.split(".")[1]
            dependents = [d.id for d in uk.enablers.values() if set(ens) & set(d.requires) and prod[d.id]]
            status = (f"{len(p)} skills" if p else
                      f"via {len(dependents)} dependent enablers" if dependents else
                      "—" if level != "A1" else "**untested**")
            lines.append(f"| {x.text} | {level} | {', '.join(f'`{e}`' for e in ens) or '**none**'} | {status} | {len(f) or '—'} |")
        lines.append("")

    lines.extend(["## Threshold themes", "", "| Threshold theme | Map theme | Situations |", "| --- | --- | --- |"])
    for x in srcs.values():
        if x.origin != "threshold":
            continue
        t = next((t for t in c.themes.values() if t.threshold == x.id), None)
        sits = (", ".join(s.title for s in t.situations) or f"none: {t.note}") if t else "**GAP**"
        lines.append(f"| {x.text} | {t.title if t else '—'} | {sits} |")
    extra = [t for t in c.themes.values() if not t.threshold]
    for t in extra:
        lines.append(f"| (not a Threshold theme) | {t.title} | {', '.join(s.title for s in t.situations)} |")
    lines.append("")

    unsourced = [s.id for s in c.skills.values() if not s.sources]
    lines.extend(["## Skills without sources", "", ", ".join(unsourced) or "None.", ""])
    flagged = [(s.id, s.flags + (uk.realizations[s.id].flags if uk and s.id in uk.realizations else [])) for s in c.skills.values()]
    flagged = [(i, f) for i, f in flagged if f]
    lines.extend(["## Flagged skills", "", "| Skill | Flags |", "| --- | --- |"]
                 + [f"| `{i}` | {', '.join(sorted(set(f)))} |" for i, f in flagged] + [""])
    return "\n".join(lines)


def coverage_report(c: Content) -> str:
    themes = list(c.themes.values())
    skills = list(c.skills.values())
    lines = ["# Coverage", "", f"{len(skills)} A1 skills from {len({s.task for s in skills})} tasks "
             f"in {sum(1 for t in themes if t.situations)} themes.", "", "## Theme × mode", "",
             "| Theme | " + " | ".join(MODES) + " | Total |", "|---" * (len(MODES) + 2) + "|"]
    tot = Counter()
    for t in themes:
        cnt = Counter(s.mode for s in skills if s.theme == t.id)
        tot.update(cnt)
        cells = [str(cnt[m]) if cnt[m] else "·" for m in MODES]
        note = f" ({t.note})" if not t.situations else ""
        lines.append(f"| {t.title}{note} | " + " | ".join(cells) + f" | {sum(cnt.values())} |")
    lines.append("| **Total** | " + " | ".join(f"**{tot[m]}**" for m in MODES) + f" | **{sum(tot.values())}** |")
    lines.extend(["", "Every blank cell is deliberate: the mode does not occur as a separate real-life task in that theme at A1. "
                  "Listening inside conversations is part of SI.", "", "## Theme × domain", "",
                  "| Theme | " + " | ".join(DOMAINS) + " |", "|---" * (len(DOMAINS) + 1) + "|"])
    for t in themes:
        if not t.situations:
            continue
        cnt = Counter(d for s in skills if s.theme == t.id for d in s.domain)
        lines.append(f"| {t.title} | " + " | ".join(str(cnt[d]) if cnt[d] else "·" for d in DOMAINS) + " |")
    lines.extend(["", "Domain gaps:", ""] + [f"- **{k}**: {v}" for k, v in c.domain_gaps.items()])
    sizes = Counter(s.size for s in skills)
    mvp = sum(1 for s in skills if s.mode in MVP_BADGE_MODES)
    lst = sum(1 for s in skills if s.mode == "L")
    lines.extend(["", "## Certifiable by stage", "",
                  "| Stage | Modes | Badges |", "| --- | --- | --- |",
                  f"| Text-only MVP | R, WI, WP | {mvp} |",
                  f"| + TTS listening | + L | {mvp + lst} |",
                  f"| + speech | + SI, SP | {len(skills)} |", "",
                  f"Sizes: S = {sizes['S']}, M = {sizes['M']}, L = {sizes['L']}.", ""])
    uk = c.languages.get("uk")
    if uk:
        kinds = Counter((e.kind, e.cefr) for e in uk.enablers.values())
        lines.extend(["## Ukrainian enablers", "", "| Kind | A1 | A2 (chunks only at A1) |", "| --- | --- | --- |"])
        for k in sorted({k for k, _ in kinds}):
            lines.append(f"| {k} | {kinds[(k, 'A1')] or '·'} | {kinds[(k, 'A2')] or '·'} |")
        chunk = Counter(u.id for r in uk.realizations.values() for u in r.enablers.required + r.enablers.supporting
                        if u.use == "formulaic" and lvl(uk.enablers[u.id].cefr) > lvl("A1"))
        lines.extend(["", "A2 grammar that A1 tasks already need as memorised chunks:", "",
                      "| Enabler | A1 skills using it as a chunk |", "| --- | --- |"]
                     + [f"| `{k}` ({uk.enablers[k].title}) | {v} |" for k, v in chunk.most_common()] + [""])
    return "\n".join(lines)


def write_csvs(c: Content, out: Path):
    uk = c.languages.get("uk")
    with (out / "overview.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "theme", "situation", "title", "mode", "cefr", "size", "domain", "prerequisites", "mvp_badge",
                    "flags", "uk_register", "uk_enablers_productive", "uk_chunks", "uk_example", "sources", "can_do"])
        theme_title = {t.id: t.title for t in c.themes.values()}
        sit_title = {s.id: s.title for t in c.themes.values() for s in t.situations}
        for s in c.skills.values():
            r = uk.realizations.get(s.id) if uk else None
            ens = (r.enablers.required if r else [])
            w.writerow([s.id, theme_title[s.theme], sit_title.get(s.situation, s.situation), s.title, s.mode, s.cefr,
                        (r.size if r and r.size else s.size), "; ".join(s.domain), "; ".join(s.prerequisites),
                        "yes" if s.mode in MVP_BADGE_MODES else "no",
                        "; ".join(sorted(set(s.flags + (r.flags if r else [])))),
                        "; ".join(r.registers) if r else "",
                        len([u for u in ens if u.use == "productive"]),
                        "; ".join(u.id for u in ens if u.use == "formulaic"),
                        r.exponents[0] if r else "", len(s.sources), s.can_do])
    if uk:
        use = defaultdict(lambda: [0, 0])
        for r in uk.realizations.values():
            for u in r.enablers.required + r.enablers.supporting:
                use[u.id][0 if u.use == "productive" else 1] += 1
        with (out / "enablers_uk.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["id", "kind", "cefr", "title", "check_channel", "requires", "skills_productive", "skills_chunk", "sources"])
            for e in uk.enablers.values():
                w.writerow([e.id, e.kind, e.cefr, e.title, e.check.channel, "; ".join(e.requires), use[e.id][0], use[e.id][1],
                            "; ".join(e.sources)])


def main(argv=None):
    argv = argv or sys.argv[1:]
    root = Path(argv[0]) if argv else Path("content")
    out = Path(argv[1]) if len(argv) > 1 else Path("reports")
    out.mkdir(parents=True, exist_ok=True)
    c = load(root)
    err, warn = check(c)
    (out / "trace.md").write_text(trace_report(c), encoding="utf-8")
    (out / "coverage.md").write_text(coverage_report(c), encoding="utf-8")
    write_csvs(c, out)
    summary = [f"skills: {len(c.skills)}"] + [f"{k}: {len(v.enablers)} enablers, {len(v.realizations)} realizations, "
                                               f"{len(v.checks)} catalogues ({sum(len(x.items) for x in v.checks.values())} items), "
                                               f"{len(v.placement)} placement catalogues ({sum(len(x.items) for x in v.placement.values())} items)"
                                               for k, v in c.languages.items()]
    text = "\n".join(summary + [f"\nERRORS ({len(err)})"] + err + [f"\nWARNINGS ({len(warn)})"] + warn) + "\n"
    (out / "validation.txt").write_text(text, encoding="utf-8")
    print(text)
    return 1 if err else 0


if __name__ == "__main__":
    sys.exit(main())
