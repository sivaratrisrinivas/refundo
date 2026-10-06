# Simulated blind labeler

> **Simulated.** This is a separate subagent, not a person. Its agreement is reported as "simulated blind labeler" and is never human inter-rater agreement.

## What it did

A subagent was given only `eval/blind/packet.json` (the rubric as the original plan wrote it, the incident windows, the bug signatures and the raw Checkpoints of ten Graded sessions: E2, E3, E4, E5, E7, E8, E9, E10, E15 and B1) and asked to label every labelable Checkpoint. A test (`tests/blind.test.ts`) proves the packet holds no expected answer, pipeline output, Failure pattern, Ticket text, cost or case title, and that the rubric carries none of the later design decisions (precedence, the late-rollback rule, repeat annotations).

**Limits, stated plainly.** The subagent was told to read only the packet; filesystem isolation was not enforced, and it made two tool calls. The packet check proves what it was *given*, not what it *could have* opened. Treat the figure as a consistency check on the rubric, not as independent human validation.

## Result

| Measure | Value |
| --- | --- |
| Sessions | 10 of the 20 Graded sessions |
| Checkpoints labeled | 45 |
| Agreement with the expected Labels | 42 of 45, 93.3% (**simulated blind labeler**) |
| Disagreements | 3 |

Stored in `eval/blind/labels.json` (the labels), `eval/blind/agreement.json` (the score) and `eval/blind/resolutions.json` (the decisions below). Regenerate the score with `bun run scripts/blind-score.ts`.

## Disagreements and decisions

| Checkpoint | Expected | Blind | Decision |
| --- | --- | --- | --- |
| E3 Checkpoint 1 | delivered | unknown | **Rubric fix.** Version 1 never said what to do with a repeated error that is not yet a loop. Rubric version 2, rule 2. |
| E3 Checkpoint 2 | delivered | unknown | **Rubric fix.** Same gap. |
| B1 Checkpoint 3 | delivered | false_completion | **Marked ambiguous.** The claim matches no file and no test: unverifiable, not contradicted. Rubric version 2, rule 3 records the principle; the expected Label stays. |

The expected answers were not edited to match the labeler. The rubric was.

Two agreements worth noting: the labeler treated a rollback at exactly 30 minutes as within the window, and called the 31-minute rollback `unknown`, which the version 1 rubric did not spell out (it reasoned that nothing else fit). Rubric version 2, rules 4 and 5 now say both explicitly. The version 2 rubric is `docs/rubric.md`.
