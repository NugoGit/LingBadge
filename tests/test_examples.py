"""The Stage 3 worked examples, run through the real policy and diagnosis code."""
from datetime import date
from pathlib import Path

import pytest
import yaml

from lingbadge.content import load
from lingbadge.diagnosis import diagnose
from lingbadge.forms import Attempt, Grade, Response, TestForm
from lingbadge.policy import (MasteryConfig, attempt_outcome, badge_awardable, badge_decision, grade_keyed, heatmap_status,
                               median_grade, needs_regrade, normalize)

ROOT = Path(__file__).resolve().parents[1]
CONTENT = load(ROOT / "content")
UK = CONTENT.languages["uk"]
CFG = MasteryConfig.load(ROOT / "config" / "mastery.yaml")


def build(att: dict) -> Attempt:
    f = dict(att["form"])
    f["rubric"] = CONTENT.rubrics[f["rubric"]]
    form = TestForm.model_validate(f)
    resp = Response.model_validate(att["response"])
    if "grade" in att:
        grade = Grade.model_validate(att["grade"])
    else:
        results, _ = grade_keyed(form, resp)
        grade = Grade(form_id=form.id, grader="key:v1", item_results=results)
    return Attempt(id=att["id"], form=form, response=resp, grade=grade, taken_on=date.fromisoformat(att["taken_on"]))


def example(name):
    return yaml.safe_load((ROOT / "examples" / name).read_text(encoding="utf-8"))


def threshold(form):
    skill = CONTENT.skills.get(form.skill)
    return CFG.threshold(form.skill, skill.threshold if skill else None)


def test_normalize():
    assert normalize("165 грн") == "165"
    assert normalize("095 723 40 16") == "0957234016"
    assert normalize("07:30") == "7:30"
    assert normalize("п’ять") == normalize("п'ять")
    assert normalize("Чоти́ри си́ри") == "чотири сири"


def test_menu_two_forms_award_badge():
    ex = example("01_food.menu.R.yaml")
    atts = [build(a) for a in ex["attempts"]]
    for a in atts:
        exp = ex["expected"][a.id]
        assert sum(a.grade.item_results.values()) == exp["item_correct"]
        assert attempt_outcome(a.form, a.grade, threshold(a.form), CFG).passed == exp["passed"]
    assert badge_decision(atts[:1], threshold(atts[0].form), CFG).awarded is False
    d = badge_decision(atts, threshold(atts[0].form), CFG)
    assert d.awarded and d.pair == ("a1", "a2")


def test_plans_gap_fails_and_is_diagnosed():
    ex = example("02_relations.plans.WI.yaml")
    att, exp = ex["attempts"][0], ex["expected"]["a1"]
    a = build(att)
    out = attempt_outcome(a.form, a.grade, threshold(a.form), CFG)
    assert out.passed is exp["passed"] and out.failed_musts == exp["failed_musts"]
    assert round(out.score, 3) == exp["score"]
    assert needs_regrade(a.form, a.grade, threshold(a.form), CFG) is exp["needs_regrade"]
    med = median_grade([Grade.model_validate(g) for g in att["regrades"]])
    assert next(c.level for c in med.criteria if c.id == "key_structures") == exp["median_key_structures"]
    dx = diagnose(a.form, med, UK, ex["enabler_status"])
    assert dx.holes[0].check_first == exp["check_first"]


def test_cafe_typed_roleplay_is_heatmap_only():
    ex = example("03_food.cafe.SI.yaml")
    a, exp = build(ex["attempts"][0]), ex["expected"]["a1"]
    out = attempt_outcome(a.form, a.grade, threshold(a.form), CFG)
    assert out.passed is exp["passed"] and round(out.score, 3) == exp["score"]
    assert badge_awardable("SI", "text") is exp["badge_awardable"]
    assert heatmap_status(out) == exp["heatmap"]
    dx = diagnose(a.form, a.grade, UK, ex["enabler_status"])
    assert dx.holes[0].enabler == exp["top_hole"] and dx.holes[0].errors == 2
    assert dx.chunks == exp["chunks"]
    assert "uk.gram.noun.gen-sg" not in [h.enabler for h in dx.holes]   # a broken chunk is not evidence about A2 grammar
    assert dx.holes[0].check_first == exp["check_first"]


def test_numbers_override_threshold():
    ex = example("04_comm.numbers.L.yaml")
    a, exp = build(ex["attempts"][0]), ex["expected"]["a1"]
    assert sum(a.grade.item_results.values()) == exp["item_correct"]
    out = attempt_outcome(a.form, a.grade, threshold(a.form), CFG)
    assert out.threshold == exp["threshold"] and out.passed is exp["passed"]
    assert diagnose(a.form, a.grade, UK).holes[0].enabler == exp["top_hole"]


def test_enabler_check():
    ex = example("05_enabler-check.gen-sg.yaml")
    a, exp = build(ex["attempts"][0]), ex["expected"]["a1"]
    wrong = sorted(k for k, v in a.grade.item_results.items() if not v)
    assert wrong == exp["wrong"]
    assert attempt_outcome(a.form, a.grade, 0.9, CFG).passed is exp["passed"]


def test_same_seed_never_pairs():
    ex = example("01_food.menu.R.yaml")
    a1 = build(ex["attempts"][0])
    a2 = a1.model_copy(update={"id": "a2", "taken_on": date(2026, 11, 20)})
    assert badge_decision([a1, a2], 0.9, CFG).awarded is False
