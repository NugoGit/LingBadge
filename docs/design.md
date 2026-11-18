# Design

This summarises the design decisions from Stages 1–4. The longer original write-up with prior-art review lives in Nugo's design doc; this file is the reference for contributors.

## Goal

Replace "I am B1" with a map of concrete, testable abilities. Each ability is small enough to learn in an afternoon to a week, it is tested directly, and the badge means the learner can really do it. Badges are certificates, not gamification: the only game elements are badges and the skill map. LingBadge **assesses only**; it does not teach.

## Two layers

| Layer | Contains | Where |
| --- | --- | --- |
| Universal | themes → situations → tasks → **skills** (task × mode), rubrics, mastery policy | `content/core`, `config/` |
| Language | **realizations** of skills, **enablers**, question catalogues, language metadata | `content/<lang>/` |

**Modes** follow the CEFR Companion Volume and ACTFL: R reading, L listening, SI spoken interaction, SP spoken production, WI written interaction, WP written production. A skill exists only for modes in which the task really happens. Ordering food is SI, reading a menu is R, and nobody "writes their restaurant order". That's why A1 has 52 skills, not 15 situations × 4 skills.

CEFR is a **tag** on skills and enablers, not a container. A realization can carry a different level than the universal skill when the language makes a task harder.

## Enablers

Enablers are the language-specific building blocks: grammar, lexis (with seed word lists), phonology, script, orthography, pragmatics, numbers.

- Each realization lists the enablers it needs as `required` or `supporting`, and as `productive` (the learner must build the form) or `formulaic` (a memorised chunk). This resolves the A1/A2 boundary: Ukrainian A1 learners say "без цукру" long before they can form genitives. The validator rejects productive use of above-level enablers.
- Enablers form a DAG via `requires` (e.g. adjective locative requires noun locative). Skills form a sparse DAG via `prerequisites`.

## Tests

| Mode | Format | Grading |
| --- | --- | --- |
| R, L | an authentic short text, or a TTS clip played at most twice; 8–12 items | by key, plus an AI judge for near-misses in short answers |
| WI, WP | a brief with must/optional content points | AI grader with rubric |
| SI (typed) | role-play with a scripted AI interlocutor and 1–2 complications | AI grader with rubric; **no badge** (typed is not spoken) |
| SP | needs speech input | not yet |

Generation is seeded and restricted to the realization's phrases and enablers. A second AI call validates each form before it is shown. Learners can void a bad test ("Fehlerhafte Aufgabe melden").

**Pass rule (conjunctive):** every must-criterion at level ≥ 2 (of 0–3) **and** weighted score ≥ 0.90 (configurable per skill; numbers by ear 0.95). An average must not hide a zero on one criterion. Keyed tests pass at ≥ 90 % correct.

**Borderline re-grading:** within 5 points of the cut, or with low grader confidence on a must-criterion, the attempt is graded three times and the median counts.

**Badge rule:** two passed forms with different content (5-gram similarity ≤ 0.30), at least one day apart, within 60 days. One short form can't tell mastery from a lucky draw.

## Statuses and the map

| Status | Meaning |
| --- | --- |
| badge | two passes as above |
| likely | placement probe 3/3, or one full pass |
| shaky | probe 2/3, or a fail close to the cut |
| unknown | clear fail |
| untested | no evidence |

**Placement** gives 3 short items per skill in a theme, one per facet of the can-do statement, from a fixed key-graded catalogue (`content/<lang>/placement`, see [placement-catalogue.md](placement-catalogue.md)); skills without a catalogue get generated items. Probes never award badges.

## Gap diagnosis

The grader tags each error with an enabler from the realization, or as a broken chunk. Diagnosis walks down the enabler DAG from the tagged enablers to the deepest weak or untested ancestor and suggests checking that first. This is how an A1 hole shows up behind a failed B1 task.

**Enabler checks** are short keyed tests that set an enabler's status. With a question catalogue they mix core rules, variants, exceptions and contrasts. See [question-catalogue.md](question-catalogue.md).

## Coverage argument

The taxonomy claims completeness relative to declared sources, with every gap visible:

- every A1 CEFR Companion Volume descriptor maps to at least one skill (paraphrased; still to be verified against the PDF);
- every A1 grammar point of the Ukrainian state standard (2024) maps to an enabler that some skill uses;
- every skill cites a source or is marked new with a reason;
- `reports/coverage.md` lists theme × mode and theme × domain, with a reason for every empty cell.

## Pluggable parts

Generator, interlocutor, grader and mastery policy are separate, and every attempt records which ones it used. The web app runs them on claude.ai (artifact capabilities) or with the learner's own API key (Anthropic or any OpenAI-compatible endpoint). Catalogue checks need no model at all.

## Known limits

- Content is unreviewed by native speakers; word lists are drafts.
- The grader has not been calibrated against human-graded cases yet (`calibration/README.md` sets the targets).
- Listening uses TTS, not real recordings. Speaking needs speech input.
- The UI is German only.
