# Question catalogues for enabler checks

An enabler check is a short test (usually 10 items, about 5 minutes) of one building block, such as the locative singular or у/в alternation. Checks never award badges. They set the enabler's status (`known`, `shaky`, `unknown`), and the gap diagnosis uses that status.

A check comes from a **question catalogue** when the enabler has one (`content/<lang>/checks/<enabler-id>.yaml`). Otherwise the app asks the AI to generate one, following the same rules. Catalogue checks need no AI, cost nothing, behave the same for everyone, and can be reviewed by native speakers.

## Facets, bands and formats

A catalogue splits the enabler into **facets**: sub-rules such as "-увати verbs → -ую" or "у before в, ф". Every facet has one band and one format, and all of its items share them.

| Band | What it tests | Example (locative) |
| --- | --- | --- |
| `core` | the regular rule with frequent words | школа → у школі |
| `variant` | regular sub-patterns that trip learners up: sound changes, soft stems, second endings | аптека → в аптеці, стіл → на столі, банк → у банку |
| `exception` | forms that must be memorised | кафе, метро stay unchanged |
| `contrast` | *when* the form applies, against a confusable neighbour | у банку vs. на пошті |

| Format | Use it when the learner … | Options |
| --- | --- | --- |
| `choice` | **picks** from a small closed set of words: у/в, і/й, ти/ви, він/вона/воно, a form against its confusable neighbour | the **complete** answer space, never invented distractors |
| `type` | **builds** a form: endings, conjugation, declension | none; give the base form as `cue` |

The rule of thumb: if the honest answer space has more than about five members, or the skill is producing the form, use `type`. Multiple choice for an inflected verb narrows dozens of possible forms to three or four and turns production into recognition.

## How a check is assembled

1. **Quotas by band.** Default blueprint: 40 % core, 30 % variant, 15 % exception, 15 % contrast. Every band present in the catalogue gets at least one item, and bands without items pass their share to the others. A catalogue can set its own `blueprint`.
2. **Spread over facets.** Within a band, items are taken round-robin across facets, so one check covers the range of the enabler.
3. **Least-seen first.** Items the learner has seen least often are preferred, so consecutive checks rarely repeat.
4. **Shuffled order**, so bands are interleaved.

The same algorithm exists in Python (`src/lingbadge/checks.py`) and JavaScript (`app/core.js`, `sampleCheck`). Tests keep both in line.

## Scoring

- Graded by key only. Answers are normalised: case, stress marks and apostrophe variants (' ʼ ’) are ignored.
- **known**: at least 90 % correct *and* no core item wrong. A miss on the basic rule is never "known".
- **shaky**: at least 70 %. **unknown**: below that.
- The result shows correct/total per band and a one-line verdict, such as "the rule is there; some exceptions are missing" or "the forms are there, but when to use them is unsure". Wrong items show their facet's rule.

## File format

```yaml
enabler: uk.gram.noun.loc-sg
lang: uk
blueprint: {core: 0.4, variant: 0.3, exception: 0.15, contrast: 0.15}   # optional
reviewed_by: []            # GitHub handles of native speakers who reviewed the whole file
facets:
- id: alternation-cons
  band: variant
  format: type
  rule: {de: "к → ц, г → з, х → с vor -і", en: "к → ц, г → з, х → с before -і"}
  instruction: {de: "Setze das Wort in der richtigen Form ein.", en: "Put the word in the right form."}
- id: u-vs-na
  band: contrast
  format: choice
  options: [у/в, на]
  rule: {de: "на bei пошта, вокзал, робота …", en: "на with пошта, вокзал, робота …"}
  instruction: {de: "у/в oder на?", en: "у/в or на?"}
items:
- {id: l13, facet: alternation-cons, stem: "Мама в ___.", cue: аптека, answer: [аптеці]}
- {id: l32, facet: u-vs-na, stem: "Мама ___ пошті.", answer: [на]}
```

| Field | Notes |
| --- | --- |
| `stem` | exactly one `___` |
| `answer` | first = canonical; add every other correct form (e.g. `[іду, йду]`) |
| `cue` | base form shown in brackets; for `type` items |
| `options` | on the facet, or per item when the set differs (e.g. `[Андрій, Андрія]`) |
| `context` | situation in the instruction language, when the answer depends on it (ти/ви) |
| `rule`, `instruction`, `context` | plain text or `{de: …, en: …}` |
| `status` | `draft` until a native speaker has checked the item, then `reviewed` |

## Writing good items

- One gap, one defensible answer. If two answers are correct, list both in `answer`, or rewrite the item.
- **Don't give the answer away.** A gender item must not have an adjective with a gender ending next to the gap. A question word like *Яка …?* already reveals feminine.
- Short, natural A1 sentences in situations from the skill map. Higher-level grammar only as fixed chunks.
- Only clear-cut cases. Where the norm itself varies (e.g. у/в after a consonant before a vowel), leave the case out.
- Aim for at least twice the check length per catalogue (20+ items for a 10-item check), and enough items per band for two different checks in a row.

Preview a sampled check: `python -m lingbadge.checks uk.gram.noun.loc-sg 7` (the last number is the seed).

## Review and reports

- Every item starts as `draft`. A native speaker sets items to `reviewed` or adds their handle to `reviewed_by` for the whole file.
- In the app, wrong answers on catalogue items have an **Einspruch** (objection) link. It opens a prefilled GitHub issue with the item id, the stem, your answer and the accepted answers. Fixes go into the YAML via pull request.
- `python -m lingbadge.validate` rejects broken items: missing gap, answer not among the options, options on `type` facets, duplicate stems. It warns about catalogues that are too small.
