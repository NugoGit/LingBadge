"""Mastery policy: key grading, scoring, the conjunctive pass rule, borderline re-grading and the two-form badge rule."""
from __future__ import annotations

import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

from .forms import Attempt, CriterionScore, Grade, Response, TestForm

CREDIT = {0: 0.0, 1: 0.5, 2: 1.0, 3: 1.0}   # "exceeds" earns no extra credit: the certificate is criterion-referenced
MEETS = 2


@dataclass
class MasteryConfig:
    score_threshold: float = 0.90
    must_min_level: int = MEETS
    forms_required: int = 2
    min_days_between: int = 1
    pair_window_days: int = 60
    max_form_similarity: float = 0.30
    borderline_margin: float = 0.05
    low_confidence: float = 0.70
    overrides: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "MasteryConfig":
        d = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls(**d.get("global", {}), overrides=d.get("overrides") or {})

    def threshold(self, skill_id: str, skill_threshold: float | None = None) -> float:
        if skill_id in self.overrides and "score_threshold" in self.overrides[skill_id]:
            return self.overrides[skill_id]["score_threshold"]
        return skill_threshold if skill_threshold is not None else self.score_threshold


# ------------------------------------------------------------------ key grading
_APOSTROPHES = "'ʼ’`´"


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFD", s.strip().lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn" or ch in "\u0306\u0308")  # drop stress, keep й/ї
    s = unicodedata.normalize("NFC", s)
    for a in _APOSTROPHES:
        s = s.replace(a, "'")
    s = re.sub(r"\s*(грн|uah|hrn)\.?$", "", s)
    s = re.sub(r"^0(\d:\d\d)$", r"\1", s)              # 07:30 -> 7:30
    s = re.sub(r"[\s\-\(\)]+(?=\d)|(?<=\d)[\s\-]+", "", s) if re.fullmatch(r"[\d\s\-\(\):.]+", s) else s
    return re.sub(r"\s+", " ", s).strip(" .!?")


def grade_keyed(form: TestForm, response: Response) -> tuple[dict[str, bool], list[str]]:
    """Exact matching after normalisation. Returns results and the ids that need grade_short_answers.md."""
    results, unsure = {}, []
    answers = response.answers or {}
    for item in form.items:
        given = normalize(answers.get(item.id, ""))
        ok = given != "" and given in {normalize(k) for k in item.key}
        results[item.id] = ok
        if not ok and given and item.type == "short_answer":
            unsure.append(item.id)
    return results, unsure


# ------------------------------------------------------------------ scoring and outcome
@dataclass
class Outcome:
    passed: bool
    score: float
    threshold: float
    failed_musts: list[str]
    reason: str


def score(form: TestForm, grade: Grade) -> float:
    if form.rubric.scale == "share":
        res = grade.item_results
        return sum(res.values()) / len(res) if res else 0.0
    levels = {c.id: c.level for c in grade.criteria}
    total = sum(c.weight for c in form.rubric.criteria)
    return sum(c.weight * CREDIT[levels.get(c.id, 0)] for c in form.rubric.criteria) / total


def attempt_outcome(form: TestForm, grade: Grade, threshold: float, cfg: MasteryConfig | None = None) -> Outcome:
    cfg = cfg or MasteryConfig()
    s = score(form, grade)
    if form.rubric.scale == "share":
        passed = s >= threshold - 1e-9
        why = f"{sum(grade.item_results.values())}/{len(grade.item_results)} correct = {s:.0%}"
        return Outcome(passed, s, threshold, [], f"{why}, needs {threshold:.0%}")
    levels = {c.id: c.level for c in grade.criteria}
    failed = [c.id for c in form.rubric.criteria if c.must and levels.get(c.id, 0) < cfg.must_min_level]
    passed = not failed and s >= threshold - 1e-9
    if failed:
        why = "must-criteria below 'meets': " + ", ".join(failed)
    elif not passed:
        why = f"score {s:.0%} below {threshold:.0%}"
    else:
        why = f"all musts met, score {s:.0%}"
    return Outcome(passed, s, threshold, failed, why)


def needs_regrade(form: TestForm, grade: Grade, threshold: float, cfg: MasteryConfig | None = None) -> bool:
    """Open responses only: close to the cut, or a must-criterion graded with low confidence near 'meets'."""
    cfg = cfg or MasteryConfig()
    if form.rubric.scale == "share":
        return False
    if abs(score(form, grade) - threshold) <= cfg.borderline_margin:
        return True
    musts = {c.id for c in form.rubric.criteria if c.must}
    return any(c.id in musts and c.level in (1, 2) and c.confidence < cfg.low_confidence for c in grade.criteria)


def median_grade(grades: list[Grade]) -> Grade:
    """Combine independent re-grades: median level per criterion (low median on ties); errors from the first grade
    whose level set equals the median, else the union."""
    ids = [c.id for c in grades[0].criteria]
    crit = []
    for cid in ids:
        lv = sorted(next(c.level for c in g.criteria if c.id == cid) for g in grades)
        conf = statistics.median(next(c.confidence for c in g.criteria if c.id == cid) for g in grades)
        crit.append(CriterionScore(id=cid, level=statistics.median_low(lv), confidence=conf))
    target = {c.id: c.level for c in crit}
    match = next((g for g in grades if {c.id: c.level for c in g.criteria} == target), None)
    errors = match.errors if match else [e for g in grades for e in g.errors]
    return Grade(form_id=grades[0].form_id, grader=grades[0].grader + f"×{len(grades)}", criteria=crit,
                 errors=errors, item_results=grades[0].item_results)


# ------------------------------------------------------------------ badge rule
def _text_of(form: TestForm) -> str:
    parts = [s.body for s in form.stimuli] + [k for i in form.items for k in i.key]
    if form.roleplay:
        parts += [form.roleplay.opening_line, form.roleplay.persona]
    return " ".join(parts).lower()


def form_similarity(a: TestForm, b: TestForm, n: int = 5) -> float:
    def grams(t):
        t = re.sub(r"\s+", " ", t)
        return {t[i:i + n] for i in range(max(len(t) - n + 1, 1))}
    ga, gb = grams(_text_of(a)), grams(_text_of(b))
    return len(ga & gb) / len(ga | gb) if ga | gb else 1.0


@dataclass
class BadgeDecision:
    awarded: bool
    pair: tuple[str, str] | None
    reason: str


def badge_decision(attempts: list[Attempt], threshold: float, cfg: MasteryConfig | None = None) -> BadgeDecision:
    cfg = cfg or MasteryConfig()
    passes = sorted((a for a in attempts if a.form.kind == "full" and attempt_outcome(a.form, a.grade, threshold, cfg).passed),
                    key=lambda a: a.taken_on)
    if not passes:
        return BadgeDecision(False, None, "no passed full form yet")
    for i, a in enumerate(passes):
        for b in passes[i + 1:]:
            days = (b.taken_on - a.taken_on).days
            if a.form.seed == b.form.seed or form_similarity(a.form, b.form) > cfg.max_form_similarity:
                continue
            if cfg.min_days_between <= days <= cfg.pair_window_days:
                return BadgeDecision(True, (a.id, b.id), f"two independent passes, {days} day(s) apart")
    if len(passes) == 1:
        return BadgeDecision(False, None, f"1 of {cfg.forms_required} passes; take a new form on another day")
    return BadgeDecision(False, None, "passes exist but not on different days within the window, or forms too similar")


def probe_status(correct: int, total: int = 3) -> str:
    return "likely" if correct == total else "shaky" if correct == total - 1 else "unknown"


def badge_awardable(mode: str, form_channel: str = "text") -> bool:
    """Spoken skills are not certified from typed role-plays (Stage 1 decision)."""
    return not (mode in {"SI", "SP"} and form_channel == "text")


def today() -> date:
    return date.today()


def heatmap_status(outcome: Outcome) -> str:
    """Status for evidence that cannot award a badge (typed role-play, single form): likely / shaky / unknown."""
    if outcome.passed:
        return "likely"
    if len(outcome.failed_musts) <= 1 and outcome.score >= 0.75:
        return "shaky"
    return "unknown"
