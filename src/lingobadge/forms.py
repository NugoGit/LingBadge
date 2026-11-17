"""Runtime models: test forms, responses, grades, attempts."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from .models import EnablerUse, Rubric, Strict

FormKind = Literal["full", "probe", "enabler_check"]
ItemType = Literal["mcq", "short_answer", "gap_fill", "transform"]


class Stimulus(Strict):
    kind: Literal["text", "audio_script", "message", "form"]
    title: str | None = None
    body: str
    plays: int | None = None            # audio: how often the learner may play it
    tts: dict | None = None             # audio: {"voice": ..., "rate": 0.85}


class Item(Strict):
    id: str
    type: ItemType
    prompt: str
    options: list[str] | None = None    # mcq only
    key: list[str]                      # accepted answers; mcq: the correct option text
    enablers: list[str] = []            # what a wrong answer points to
    stimulus: int | None = None         # index into stimuli, for multi-clip listening


class ContentPoint(Strict):
    id: str
    text: str
    must: bool = True


class RoleplayScript(Strict):
    persona: str
    setting: str
    register_: Literal["formal", "informal"] = Field(default="formal", alias="register")
    learner_goal: str
    required_moves: list[ContentPoint]
    complications: list[str]
    opening_line: str
    max_turns: int = 12


class TestForm(Strict):
    __test__ = False  # not a pytest class
    id: str
    kind: FormKind = "full"
    skill: str                          # skill id, or enabler id for kind=enabler_check
    lang: str
    seed: int
    template: str
    generator: str
    instruction_language: str = "en"
    stimuli: list[Stimulus] = []
    items: list[Item] = []
    brief: list[ContentPoint] = []      # WI / WP / SP
    word_range: tuple[int, int] | None = None
    roleplay: RoleplayScript | None = None
    rubric: Rubric
    rubric_specifics: dict[str, str] | None = None
    enablers: list[EnablerUse] = []


class Turn(Strict):
    speaker: Literal["learner", "interlocutor"]
    text: str


class Response(Strict):
    form_id: str
    answers: dict[str, str] | None = None     # keyed items
    text: str | None = None                   # WI / WP / SP transcript
    transcript: list[Turn] | None = None      # SI


class CriterionScore(Strict):
    id: str
    level: int = Field(ge=0, le=3)
    confidence: float = Field(default=1.0, ge=0, le=1)
    evidence: list[str] = []


class ErrorTag(Strict):
    span: str
    correction: str
    criterion: str
    enabler: str | None = None          # productive enabler the error points to
    chunk: str | None = None            # set instead when the error sits inside a memorised chunk
    blocks_meaning: bool = False


class Grade(Strict):
    form_id: str
    grader: str
    item_results: dict[str, bool] = {}
    criteria: list[CriterionScore] = []
    errors: list[ErrorTag] = []
    needs_review: bool = False


class Attempt(Strict):
    id: str
    form: TestForm
    response: Response
    grade: Grade
    taken_on: date
