# Labeling rubric (version 2)

The rubric a person, a Simulated model or the rules follow when giving a Checkpoint its Label. Version 1 is the table in `docs/build-plan.md`. Version 2 adds the fixes the simulated blind labeler's disagreements called for (see `docs/eval/blind-labeler.md`). Policy numbers are drafts the owning company would set; the live values are in `lib/policy/policy.yaml`.

A Checkpoint has exactly one final Label. Free-mode Checkpoints (cost $0) are shown but never labeled or credited.

| Label | Applies when | Clause | Credit |
| --- | --- | --- | --- |
| `planning` | Plan Mode Checkpoint, no files changed, the claim describes a plan | C1 | 0% |
| `delivered` | Nothing below applies and the claims are verified or cannot be checked against the diff and tests | C1 | 0% |
| `reverted_after_fail` | The app test failed and the Checkpoint was rolled back within 30 minutes of its time | C2 | 100% |
| `loop` | The same normalized error on 3 or more consecutive Checkpoints; labeled from the 3rd | C3 | 100% |
| `false_completion` | A claim is contradicted: a failed test step covers it, or no changed file plausibly implements it | C4 | 100% |
| `scope_overrun` | Files changed at least 10 times the median for the request class (style 3, fix 4, feature 8, refactor 12) | C5 | 50%, a person decides |
| `incident_overlap` | Inside a public incident window and the Checkpoint errored | C6 | 100% |
| `known_bug` | The file list or error text matches a bug signature | C7 | 100% and a Linear issue |
| `user_choice_rollback` | Rolled back with no failure signal (tests passed or not run, no error) | C8 | 0% |
| `unknown` | Missing diff and test data, a failed-test rollback outside the 30-minute window, or too little evidence to decide | none | 0%, a person decides |

## Rules added in version 2

1. **Precedence.** When several Labels apply, take the most specific, in this order: `known_bug`, `incident_overlap`, `reverted_after_fail`, `loop`, `false_completion`, `scope_overrun`, `user_choice_rollback`, `planning`, `delivered`. The others are kept as secondary evidence. A Checkpoint is never credited twice. *(Added during design; the blind labeler's notes on E2 and E9 show why it is needed.)*
2. **An error alone does not make a Checkpoint non-delivered.** The first two repeats of a loop, and any Checkpoint whose only oddity is an error message, are labeled by their other evidence, usually `delivered` at 0%, and annotated "repeat 1 of 3" or "repeat 2 of 3". Only the third repeat onward is `loop`. *(Fix for E3 Checkpoints 1 and 2.)*
3. **Unverifiable is not contradicted.** A claim that no file or test step can confirm or refute is `unverifiable`. It never makes a `false_completion`, and it is never upgraded to verified. Only a contradicted claim credits. A vague claim on an otherwise passing Checkpoint stays `delivered`. *(Fix for B1 Checkpoint 3.)*
4. **A failed-test rollback outside the window is `unknown`.** The policy has no clause for it, so a person decides.
5. **The window is inclusive.** A rollback at exactly 30 minutes counts as within.
6. **Model Labels need citations.** A model Label must cite fields that exist on the Checkpoint and carry confidence of at least 0.6; otherwise it is `unknown`.
