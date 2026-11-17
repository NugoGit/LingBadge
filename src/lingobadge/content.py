"""Load the content tree into models."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .models import Enabler, Realization, Rubric, Skill, Source, Theme


@dataclass
class Language:
    code: str
    sources: dict[str, Source] = field(default_factory=dict)
    enablers: dict[str, Enabler] = field(default_factory=dict)
    realizations: dict[str, Realization] = field(default_factory=dict)


@dataclass
class Content:
    sources: dict[str, Source]
    themes: dict[str, Theme]
    domain_gaps: dict[str, str]
    skills: dict[str, Skill]
    rubrics: dict[str, Rubric]
    languages: dict[str, Language]
    errors: list[str] = field(default_factory=list)

    @property
    def situations(self) -> dict[str, str]:
        return {s.id: t.id for t in self.themes.values() for s in t.situations}

    def all_sources(self) -> dict[str, Source]:
        out = dict(self.sources)
        for lang in self.languages.values():
            out.update(lang.sources)
        return out


def _read(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _load_dir(path: Path, model, key: str, errors: list[str]) -> dict:
    out = {}
    for f in sorted(path.glob("*.yaml")):
        try:
            obj = model.model_validate(_read(f))
        except Exception as e:  # pydantic ValidationError or YAML error
            errors.append(f"{f.relative_to(path.parents[2])}: {e}")
            continue
        k = getattr(obj, key)
        if k in out:
            errors.append(f"duplicate id {k} in {f.name}")
        if f.stem != k:
            errors.append(f"file name {f.name} does not match id {k}")
        out[k] = obj
    return out


def load(root: Path) -> Content:
    errors: list[str] = []
    core = root / "core"
    sources = {s["id"]: Source.model_validate(s) for s in _read(core / "sources.yaml")["sources"]}
    tdoc = _read(core / "themes.yaml")
    themes = {t["id"]: Theme.model_validate(t) for t in tdoc["themes"]}
    skills = _load_dir(core / "skills", Skill, "id", errors)
    rubrics = _load_dir(core / "rubrics", Rubric, "id", errors)
    languages = {}
    for d in sorted(p for p in root.iterdir() if p.is_dir() and p.name != "core"):
        lang = Language(d.name)
        if (d / "sources.yaml").exists():
            lang.sources = {s["id"]: Source.model_validate(s) for s in _read(d / "sources.yaml")["sources"]}
        if (d / "enablers").exists():
            lang.enablers = _load_dir(d / "enablers", Enabler, "id", errors)
        if (d / "realizations").exists():
            lang.realizations = _load_dir(d / "realizations", Realization, "skill", errors)
        languages[d.name] = lang
    return Content(sources, themes, tdoc.get("domain_gaps", {}), skills, rubrics, languages, errors)
