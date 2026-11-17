from pathlib import Path

import pytest

from lingbadge.checks import quotas, sample, validate_catalogue
from lingbadge.content import load

ROOT = Path(__file__).resolve().parents[1]
C = load(ROOT / "content")
CATS = [(code, cat) for code, lang in C.languages.items() for cat in lang.checks.values()]


def test_quotas_cover_every_band_and_sum_to_n():
    q = quotas(10, {"core": 20, "variant": 8, "exception": 4, "contrast": 6})
    assert sum(q.values()) == 10 and all(v >= 1 for v in q.values())
    assert q["core"] >= q["variant"] >= q["exception"]


def test_quotas_respect_small_bands():
    q = quotas(10, {"core": 20, "exception": 1})
    assert q == {"core": 9, "exception": 1}


@pytest.mark.parametrize("code,cat", CATS, ids=[c.enabler for _, c in CATS])
def test_catalogue_is_valid(code, cat):
    err, _ = validate_catalogue(cat, C.languages[code].enablers)
    assert not err, err


@pytest.mark.parametrize("code,cat", CATS, ids=[c.enabler for _, c in CATS])
def test_sample_spreads_over_bands_and_prefers_unseen(code, cat):
    n = C.languages[code].enablers[cat.enabler].check.items
    first = sample(cat, n, seed=1)
    assert len(first) == min(n, len(cat.items)) and len({i.id for i in first}) == len(first)
    bands = {f.id: f.band for f in cat.facets}
    assert {bands[i.facet] for i in first} == set(bands[i.facet] for i in cat.items) or n < len(set(bands.values()))
    seen = {i.id: 1 for i in first}
    second = sample(cat, n, seen=seen, seed=2)
    overlap = len({i.id for i in first} & {i.id for i in second})
    assert overlap <= max(0, 2 * n - len(cat.items)) + 2
