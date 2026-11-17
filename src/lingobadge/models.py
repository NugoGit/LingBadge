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
