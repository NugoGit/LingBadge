# LingBadge

Language certification by small, real-life skills instead of whole CEFR levels.

Each skill is something you can actually do, such as ordering at a café, reading a timetable or writing a message to arrange a meeting. You earn a badge for a skill when you pass two independent tests on different days, and the badge is all or nothing. Behind every skill sit *enablers*: the grammar, vocabulary and pragmatics it needs. When a test goes wrong, LingBadge points to the enabler that is most likely missing and offers a short check for it.

The first language pack is **Ukrainian A1** (52 skills, 64 enablers). A 5-skill **Persian** sketch tests whether the universal core really is language-independent.

> **Status: early prototype.** The Ukrainian content is a draft that no native speaker has reviewed yet. The user interface is in German. Only A1 exists. Typed role-plays show your level but award no speaking badge.

## Try it

**Online:** <https://nugogit.github.io/LingBadge/> (once GitHub Pages is enabled for the repo; see below).

**Locally**, without installing anything: download the repository and open `app/index.html` in a browser. If your browser blocks local files, serve the folder:

```
python -m http.server -d app 8000      # then open http://localhost:8000
```

What works without an AI provider, and what needs one:

| Feature | Without AI | With an API key |
| --- | --- | --- |
| Skill map, badges | ✓ | ✓ |
| Placement test from a fixed catalogue | ✓ (all 52 Ukrainian skills) | ✓ |
| Grammar checks with a question catalogue | ✓ (13 Ukrainian enablers so far) | ✓ |
| Grammar checks without a catalogue | – | generated per check |
| Skill tests (reading, listening, writing, typed role-play) | – | ✓ |
| Placement for skills without a catalogue (other languages) | – | generated per run |

To use AI features, open **Einstellungen** (settings) and choose a provider:

- **Anthropic (Claude)**: paste an API key from the [Claude Console](https://console.anthropic.com). Set a spending limit there. A full test costs a few cents.
- **OpenAI-compatible**: any endpoint with `/chat/completions`, including local models via [Ollama](https://ollama.com) or LM Studio. Ollama must allow the page's origin, e.g. `OLLAMA_ORIGINS=* ollama serve`.

Your API key and your results stay in this browser (`localStorage`). Use **Herunterladen** (download) in the settings to back them up or move them to another browser.

Listening tests use your browser's speech voices. Firefox only offers voices installed in the operating system, which often lack Ukrainian; Edge and Chrome have online voices.

The same app also runs as a claude.ai artifact. There, Claude calls count against the user's own claude.ai plan and no API key is needed.

## How it works

- **Skills** are universal: *task × mode*, where the mode is how the task happens in real life (R reading, L listening, SI spoken interaction, SP spoken production, WI written interaction, WP written production). They live in `content/core/skills`.
- **Realizations** say what a skill takes in one language: target phrases, register, variety and the enablers it needs (`content/<lang>/realizations`).
- **Enablers** are the building blocks: grammar, vocabulary, phonology, script, orthography, pragmatics. An enabler is used either *productively* (the learner builds the form) or *formulaically* (a memorised chunk, which may come from a higher level).
- **Tests** are generated per attempt, checked by a second model call, and graded against explicit rubrics. To pass, every must-criterion has to be met *and* the score has to reach 90 %.
- **Badges** need two passed tests with different content, on different days, within 60 days.
- **Enabler checks** come from a hand-written **question catalogue** when one exists: items are tagged by band (core, variant, exception, contrast), and a check mixes all bands. See [docs/question-catalogue.md](docs/question-catalogue.md).

Full design: [docs/design.md](docs/design.md).

## Repository layout

```
app/                     the web app (static files; open index.html)
  content.js             generated bundle of content/ (do not edit; run tools/build_app_content.py)
  core.js                scoring, pass and badge rules, check sampling, prompts (also tested in node)
  platform.js            standalone mode: local storage, API providers
content/core/            universal layer: themes, 52 skills, rubrics, test templates, sources
content/uk/              Ukrainian pack: language.yaml, enablers, realizations, checks (question catalogues)
content/fa/              Persian sketch
config/                  mastery policy (thresholds, badge rule), app settings
src/lingbadge/           Python: models, loader, validator, catalogue sampler, scaffold
prompts/                 reference prompts (generation, validation, interlocutor, grading)
examples/                five worked test examples used as test fixtures
calibration/             how grader calibration works
reports/                 generated by the validator: trace, coverage, CSV overviews
templates/language-pack/ starting point for a new language
docs/                    design, question catalogues, language packs
```

## Development

```
pip install -e ".[dev]"
python -m lingbadge.validate content reports   # validate all content, write reports/
pytest -q                                       # Python tests
python tools/build_app_content.py               # rebuild app/content.js after content changes
node tests/core.test.js                         # app logic tests
python -m lingbadge.checks uk.gram.verb.present # preview one sampled check from a catalogue
```

CI runs all of these on every pull request. Merges to `main` deploy the app to GitHub Pages.

**Enable GitHub Pages once:** Settings → Pages → Source: *GitHub Actions*.

## Contributing

Native-speaker review, new catalogue items, new language packs and bug reports are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Not chosen yet. Until a license is added, the code and content are not licensed for reuse.
