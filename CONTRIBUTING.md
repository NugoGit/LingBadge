# Contributing

Thanks for helping. Most contributions are YAML edits; you don't need to write code.

## Ways to help

| You are … | Do this |
| --- | --- |
| a learner | Use the app and report wrong items with the **Einspruch** link, or open a [catalogue item issue](../../issues/new?template=catalogue-item.yml). |
| a native speaker or teacher | Review a catalogue (`content/<lang>/checks/*.yaml`, `content/<lang>/placement/*.yaml`) or realizations; fix items; set `status: reviewed` or add yourself to `reviewed_by`. |
| learning or teaching another language | Start a language pack: [docs/language-packs.md](docs/language-packs.md). |
| a developer | See the open issues; the app is plain HTML/JS in `app/`, the tooling is Python in `src/lingbadge/`. |

## Workflow

1. Fork, then create a branch (`catalogue/uk-loc-sg`, `lang/es`, `fix/…`).
2. Make the change and run:
   ```
   pip install -e ".[dev]"
   python -m lingbadge.validate content reports
   pytest -q
   python tools/build_app_content.py      # if you changed content/ or config/
   node tests/core.test.js                # if you changed app/
   ```
3. Commit `app/content.js` together with content changes. CI checks that it is up to date.
4. Open a pull request. Say which language, what you changed, and who reviewed the language.

## Content rules

- **Universal vs. language.** `content/core` is shared by every language. Changing a skill there affects all packs, so open an issue first.
- **Levels.** Use the language's official standard for CEFR tags. Grammar above the level appears only as `formulaic` chunks.
- **Catalogues.** Follow [docs/question-catalogue.md](docs/question-catalogue.md): one gap, one defensible answer (or list all correct ones), `choice` only for closed sets with all options shown, `type` when the learner builds a form, no give-aways. Placement catalogues follow [docs/placement-catalogue.md](docs/placement-catalogue.md): three facets per skill, at least two items each.
- **Sources.** Cite where a list or level comes from in `sources.yaml`. Paraphrase descriptors; don't copy copyrighted text.
- **Review status.** New items are `draft`. Only native speakers mark items `reviewed`.

## Reporting app problems

Open a [bug report](../../issues/new?template=bug.yml) with the browser, whether you used claude.ai or the standalone page, and what you clicked. Don't paste API keys.
