from pathlib import Path

import pytest

from lingbadge.content import load
from lingbadge.models import PLACEMENT_FACETS
from lingbadge.placement import correct, loose, sample, validate_placement

ROOT = Path(__file__).resolve().parents[1]
C = load(ROOT / "content")
CATS = [(code, cat) for code, lang in C.languages.items() for cat in lang.placement.values()]


def test_every_ukrainian_skill_has_a_placement_catalogue():
    uk = C.languages["uk"]
    assert set(uk.realizations) <= set(uk.placement)


@pytest.mark.parametrize("code,cat", CATS, ids=[c.skill for _, c in CATS])
def test_catalogue_is_valid(code, cat):
    err, _ = validate_placement(cat, C.skills)
    assert not err, err


@pytest.mark.parametrize("code,cat", CATS, ids=[c.skill for _, c in CATS])
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
