from pathlib import Path

import pytest

from lingbadge.content import load
from lingbadge.models import PLACEMENT_FACETS
from lingbadge.placement import correct, localized, loose, sample, validate_placement

ROOT = Path(__file__).resolve().parents[1]
C = load(ROOT / "content")
CATS = [(code, cat) for code, lang in C.languages.items() for cat in lang.placement.values()]


@pytest.mark.parametrize("code", ["uk", "es"])
def test_every_skill_has_a_placement_catalogue(code):
    lang = C.languages[code]
    assert set(lang.realizations) <= set(lang.placement)


@pytest.mark.parametrize("code,cat", CATS, ids=[f"{c}:{x.skill}" for c, x in CATS])
def test_catalogue_is_valid_and_bilingual(code, cat):
    err, warn = validate_placement(cat, C.skills)
    assert not err, err
    assert not [w for w in warn if "de and en" in w], warn


@pytest.mark.parametrize("code,cat", CATS, ids=[f"{c}:{x.skill}" for c, x in CATS])
def test_one_item_per_facet_and_rotation(code, cat):
    first = sample(cat, seed=1)
    assert len(first) == PLACEMENT_FACETS and len({i.facet for i in first}) == PLACEMENT_FACETS
    second = sample(cat, seen={i.id: 1 for i in first}, seed=2)
    assert not {i.id for i in first} & {i.id for i in second}   # every facet has >= 2 items


def test_loose_matching():
    assert loose("Повторіть, будь ласка!") == loose("повторіть будь ласка")
    assert loose("9.20 Uhr") == loose("09:20") == "9:20"
    assert loose("89,90 грн") == loose("89,90")
    item = next(i for i in C.languages["uk"].placement["food.cafe.SI"].items if i.id == "order-1")
    assert correct(item, "Каву") and correct(item, "каву ") and not correct(item, "кава") and not correct(item, "")


def test_localized_options_follow_the_instruction_language():
    item = next(i for i in C.languages["uk"].placement["comm.signs.R"].items if i.id == "door-1")
    assert localized(item.answer, "de") == ["Ausgang"] and localized(item.answer, "en") == ["Exit"]
    assert correct(item, "Exit", "en") and not correct(item, "Exit", "de")
