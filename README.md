# lingobadge — Stage 3 (A1 content + test design)

Universal skills in `content/core`, language layers in `content/<lang>`.

```
content/core/sources.yaml        source registry (CEFR CV paraphrased, Ukrainian standard, Threshold themes)
content/core/themes.yaml         themes → situations; domain gaps
content/core/skills/*.yaml       52 A1 skills (id = <theme>.<task>.<MODE>)
content/core/rubrics/*.yaml      generic rubrics per mode family (refined in Stage 3)
content/uk/sources.yaml          Ukrainian standard 2024, Catalogue C (grammar) by level
content/uk/enablers/*.yaml       64 enablers (grammar, lexis with seed word lists, phonology, script, pragmatics)
content/uk/realizations/*.yaml   one per skill: register, variety, key phrases, enablers (productive / formulaic)
content/fa/                      5-skill Persian sketch + findings.yaml
config/mastery.yaml              badge policy
src/lingobadge/                  models, loader, validator
reports/                         generated: validation.txt, trace.md, coverage.md, overview.csv, enablers_uk.csv
```

Validate and regenerate reports (needs `pydantic`, `pyyaml`):

```
PYTHONPATH=src python -m lingobadge.validate content reports
```

Enabler use: `productive` = the learner must build the form; `formulaic` = a memorised chunk whose grammar
belongs to a higher level (e.g. genitive in "без цукру" at A1). Using an above-level enabler productively is a validation error.

## Stage 3 additions

```
content/core/templates.yaml      test templates per mode, enabler checks, probes
content/core/rubrics/            level descriptors 0-3, scoring rule, chunk rule
prompts/                         generate_form, validate_form, interlocutor, grade_open, grade_short_answers
src/lingobadge/forms.py          TestForm, Response, Grade, Attempt
src/lingobadge/policy.py         key grading, scoring, pass rule, re-grading, two-form badge rule, heatmap status
src/lingobadge/diagnosis.py      error tags -> holes -> checks to take first
examples/                        five worked examples (fixtures)
calibration/README.md            calibration sets and targets
tests/test_examples.py           runs the worked examples through policy and diagnosis
```

Run the tests (needs `pytest`): `PYTHONPATH=src python -m pytest -q tests`

The YAML under `content/` is now the source of truth; the Stage 2 authoring scripts are retired.
