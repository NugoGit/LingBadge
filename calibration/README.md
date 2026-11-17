# Grader calibration

A calibration case = a form, a response and a reference grade (levels per criterion, error tags, pass/fail).
Run `calibrate` (Stage 4) after every change to a grading prompt or model, and before trusting badges.

## Sets per language, per mode family (WI, SI; R/L short-answer judging)

| Kind | How many to start | What it catches |
| --- | --- | --- |
| Native-correct responses | 5 | Grader inventing errors (false alarms) |
| Clear passes with minor slips | 5 | Grader too strict |
| Planted single gap in a key structure (e.g. «о шоста», «борщ і кава») | 8 | Grader too lenient: the core risk |
| Planted slip with the same structure correct elsewhere | 4 | Slip vs gap distinction |
| Broken chunk («без цукор») | 4 | Chunk errors tagged to the chunk, not to A2 grammar |
| Russianisms / surzhyk («кушати», «на протязі», «приймати участь») | 4 | Leniency on contact-language forms |
| Missing content point | 4 | task_completion |
| Register switch (ти/ви) | 3 | appropriacy |

Reference grades: written by Claude for the first weeks (marked `reference: provisional`), replaced by your tutor's
grades before any badge counts outside personal use.

## Targets (all must hold)

| Metric | Target |
| --- | --- |
| Pass/fail agreement with reference | ≥ 95% |
| Must-criteria level within ±1 | 100% |
| Exact level agreement per criterion | ≥ 80% |
| Planted gap recall (gap found and tagged to the right enabler) | ≥ 90% |
| False errors on native-correct responses | ≤ 1 per 10 responses |
| Same response graded twice, same pass/fail | 100% |

If a target fails, fix the prompt or the rubric descriptor, not the reference grade.

The worked examples in `examples/` are the first calibration cases.
