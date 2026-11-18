"""Content models. Universal layer (Skill, Theme, Rubric) and language layer (Enabler, Realization)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["R", "L", "SI", "SP", "WI", "WP"]
Cefr = Literal["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]
Size = Literal["S", "M", "L"]
Domain = Literal["personal", "public", "occupational", "educational"]
CEFR_ORDER = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]

# Modes the text-only MVP can certify. SI/SP need audio; L needs TTS.
MVP_BADGE_MODES = {"R", "WI", "WP"}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Source(Strict):
    id: str
    origin: str
    text: str
    mode: str | None = None
    deferred: str | None = None


class Situation(Strict):
    id: str
    title: str


class Theme(Strict):
    id: str
    title: str
    threshold: str | None = None
    note: str | None = None
    situations: list[Situation] = []


class Skill(Strict):
    id: str
    task: str
    situation: str
    title: str
    can_do: str
    mode: Mode
    domain: list[Domain]
    cefr: Cefr
    prerequisites: list[str] = []
    recommended_before: list[str] = []
    sources: list[str] = Field(min_length=1)
    size: Size
    rubric: str
    threshold: float | None = None
    flags: list[str] = []
    version: int = 1
    status: Literal["draft", "reviewed", "retired"] = "draft"

    @property
    def theme(self) -> str:
        return self.id.split(".")[0]


class Criterion(Strict):
    id: str
    must: bool
    weight: float
    meets: str
    levels: dict[int, str] | None = None   # 0 absent, 1 below, 2 meets, 3 exceeds


class Rubric(Strict):
    id: str
    scale: list[int] | str
    criteria: list[Criterion]
    scoring: str | None = None
    chunks: str | None = None


class EnablerCheck(Strict):
    template: str
    items: int
    threshold: float
    channel: Literal["text", "audio"]


class Enabler(Strict):
    id: str
    lang: str
    kind: str
    title: str
    cefr: Cefr
    requires: list[str] = []
    sources: list[str] = []
    note: str | None = None
    words: list[str] | None = None
    check: EnablerCheck


class EnablerUse(Strict):
    id: str
    use: Literal["productive", "formulaic"]


class RealizationEnablers(Strict):
    required: list[EnablerUse]
    supporting: list[EnablerUse] = []


class Realization(Strict):
    skill: str
    lang: str
    cefr: Cefr
    size: Size | None = None
    registers: list[Literal["formal", "informal"]] = Field(alias="register")
    variety: str | None = None
    exponents: list[str]
    enablers: RealizationEnablers
    rubric_specifics: dict[str, str] | None = None
    flags: list[str] = []
    note: str | None = None
    version: int = 1
    status: Literal["draft", "reviewed", "retired"] = "draft"


# ---------------------------------------------------------------- question catalogue (enabler checks)
Band = Literal["core", "variant", "exception", "contrast"]
CheckFormat = Literal["choice", "type"]
Text = str | dict[str, str]          # plain text or {instruction-language: text}
BANDS: tuple[str, ...] = ("core", "variant", "exception", "contrast")
DEFAULT_BLUEPRINT = {"core": 0.4, "variant": 0.3, "exception": 0.15, "contrast": 0.15}


class CheckFacet(Strict):
    """One sub-rule of an enabler. Format and instruction live here so every item of a facet looks the same."""
    id: str
    band: Band
    format: CheckFormat
    rule: Text                         # what the facet tests, shown after the check
    instruction: Text                  # shown to the learner
    options: list[str] | None = None   # choice only: the complete answer space


class CheckItem(Strict):
    id: str
    facet: str
    stem: str                          # target-language sentence with exactly one ___
    cue: str | None = None             # base form shown in brackets (type items)
    answer: list[str]                  # first = canonical, rest = also accepted
    options: list[str] | None = None   # choice only: overrides the facet's options
    context: Text | None = None        # situation in the instruction language
    status: Literal["draft", "reviewed"] = "draft"


class CheckCatalogue(Strict):
    enabler: str
    lang: str
    blueprint: dict[Band, float] | None = None
    reviewed_by: list[str] = []
    facets: list[CheckFacet]
    items: list[CheckItem]


# ---------------------------------------------------------------- placement catalogues
PLACEMENT_FACETS = 3   # one item per facet per run -> 3/3 likely, 2/3 shaky, else unknown


class PlacementFacet(Strict):
    """One part of a skill's can-do statement (e.g. ordering, asking about a dish, paying)."""
    id: str
    label: Text


class PlacementItem(Strict):
    """A fixed placement item, graded by key. Exactly one of text/audio for R/L skills.

    choice: options in the target language (pick the fitting reply / form) or in the instruction
            language (comprehension questions); answer[0] is the right option.
    type:   short answer the learner types (a form in a gap, a number, a time); every
            accepted variant is listed in answer.
    """
    id: str
    facet: str
    format: CheckFormat
    prompt: Text                       # task in the instruction language
    text: str | None = None            # R: the text to read
    audio: str | None = None           # L: the script read aloud (TTS)
    context: str | None = None         # SI/SP/WI: what the other person says or writes
    stem: str | None = None            # target-language line with one ___
    cue: str | None = None
    answer: list[str]
    options: list[str] | None = None
    status: Literal["draft", "reviewed"] = "draft"


class PlacementCatalogue(Strict):
    skill: str
    lang: str
    reviewed_by: list[str] = []
    facets: list[PlacementFacet]
    items: list[PlacementItem]
