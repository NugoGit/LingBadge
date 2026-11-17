# Adding a language pack

The 52 A1 skills in `content/core/skills` are universal: they describe what people do, not how it's said. A language pack says how it's said. A pack doesn't have to cover every skill. The app shows the skills that have a realization in the selected language.

## 1. Scaffold

```
pip install -e ".[dev]"
python -m lingbadge.scaffold es Spanisch Spanish
```

This creates `content/es/` from `templates/language-pack/`, with one example of each file type. Fill in the TODOs.

## 2. What goes where

| File | Contains |
| --- | --- |
| `language.yaml` | name, speech tag (`tts`), writing direction, helper keys, variety, ti/vi-type registers, typical errors for the reviewer prompt |
| `sources.yaml` | the references the pack is based on: national standard, curriculum (e.g. Plan curricular Cervantes, Profile Deutsch), frequency lists |
| `enablers/<id>.yaml` | one grammar point, word list, sound or pragmatic rule, with its CEFR level, prerequisites (`requires`) and check settings |
| `realizations/<skill-id>.yaml` | per skill: register, variety, 3–6 typical target phrases (`exponents`), required and supporting enablers (`productive` or `formulaic`), key structures for grading |
| `checks/<enabler-id>.yaml` | optional question catalogue for an enabler; see [question-catalogue.md](question-catalogue.md) |

Ukrainian (`content/uk`) is the complete reference. Persian (`content/fa`) shows a right-to-left, diglossic language with `variety` set per realization.

## 3. Rules the validator enforces

- Ids: enablers start with the language code (`es.gram.ser-estar`); realization file names equal the skill id.
- Every referenced enabler, skill and source exists. There are no cycles in `requires`.
- **Productive use of an enabler above the realization's level is an error.** Mark it `formulaic` if learners only need a memorised chunk (Ukrainian A1 "без цукру" uses the genitive as a chunk), or raise the level.
- Catalogue items are well-formed (see the catalogue doc).

```
python -m lingbadge.validate content reports    # errors fail CI; warnings list gaps (unused enablers, missing realizations)
```

`reports/coverage.md` and `reports/trace.md` show which skills, sources and grammar points are covered.

## 4. Try it in the app

```
python tools/build_app_content.py
python -m http.server -d app 8000
```

Pick the language in the top-right selector. Without an API key you can take catalogue checks. With a key, tests are generated from your realizations, so good `exponents` and `key_structures` matter.

## 5. Review before "reviewed"

Everything starts as `status: draft`. A native speaker (ideally a teacher) reviews realizations and catalogues before they are marked `reviewed`. Please say in the pull request who reviewed what.

## Notes from the Persian sketch

- The universal skills held unchanged. If a skill doesn't fit your language, open an issue rather than editing `content/core`: a change there affects every pack.
- Variety (written vs. colloquial) is set per realization, not per language.
- Script, digits and transliteration conventions belong to the language layer as enablers.
