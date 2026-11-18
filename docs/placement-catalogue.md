# Placement catalogues

The placement test (*Einstufung*) shows where to start testing. It is built from fixed, hand-written items in `content/<lang>/placement/<skill-id>.yaml` and graded by key, so it works without an AI provider and gives the same result for the same answers. Ukrainian has a catalogue for all 52 A1 skills (478 items).

## Shape

Each catalogue splits the skill's can-do statement into **exactly three facets**, e.g. for *Order in a cafe*: ordering, asking about a dish or "we're out of that", the bill and paying. A run takes **one item per facet**, so every run covers the whole skill: 3/3 = *likely*, 2/3 = *shaky*, otherwise *gap*. Each facet needs at least two items; on a repeat, the app prefers items the learner has seen least, so repeated placements rotate through the pool.

```yaml
skill: food.cafe.SI
lang: uk
facets:
- {id: order, label: Essen und Getränke bestellen}
- {id: ask, label: "Nachfragen; „gibt es nicht“"}
- {id: pay, label: Rechnung und Bezahlen}
items:
- id: order-1
  facet: order
  format: type
  prompt: Bestellen Sie einen Kaffee.      # task in the instruction language
  context: Що будете замовляти?            # what the other person says (optional)
  stem: Мені ___, будь ласка.              # the learner's line, one gap
  cue: кава                                # base form or meaning (optional)
  answer: [каву]                           # every accepted variant
- id: pay-3
  facet: pay
  format: choice
  prompt: Welche Antwort passt?
  context: Готівкою чи карткою?
  options: ["Карткою, будь ласка.", "Рахунок, будь ласка.", "Меню, будь ласка.", "Без цукру, будь ласка."]
  answer: ["Карткою, будь ласка."]
```

## Items by mode

| Mode | Item | Notes |
| --- | --- | --- |
| R reading | `text` + question | comprehension options in the instruction language, or a typed number/time |
| L listening | `audio` (read aloud by the browser voice, max. two plays) + question | never a `text`; without a voice the learner can reveal the script, and that skill is then not placed |
| SI / SP / WI | `context` + `stem` gap (type) or fitting reply (choice) | a recognition-and-gap approximation of speaking and writing, not a measure of it |

## Format rule

The same rule as for [enabler checks](question-catalogue.md): **choice** when the learner picks from a small set (which reply fits, which form of a closed set, what a sign means); **type** when they build a form (case ending, verb form, number). Choice distractors must be clearly wrong in this situation: wrong function, wrong register, or ungrammatical. Avoid a second option that a native speaker would also accept. The app shuffles options.

Typed answers are compared after normalisation: case, stress marks, apostrophe variants, punctuation and a trailing "Uhr" are ignored; `9.20` and `09:20` count as `9:20`. List real variants (`зрозумів, зрозуміла`; `Вчора, Учора`) in `answer`.

## Tools

```
python -m lingbadge.placement uk food.cafe.SI 7     # preview one run (seed 7)
python -m lingbadge.validate content reports        # checks every catalogue
```

Learners can report a rejected answer with the **Einspruch** link on the result page; it opens a pre-filled issue labelled `placement`.
