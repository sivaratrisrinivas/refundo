# Eval audit

An audit of this project's own eval pipeline using the `eval-audit` checklist, run after the pipeline and harness were built. Findings are ordered by impact. Each is fixed, or deferred with its reason. **Every person in the loop here is simulated** (a blind-labeler subagent and an annotator subagent); that is itself a finding (4 below).

Artifacts inspected: `eval/expected.json`, `eval/reports/`, `lib/eval/`, `lib/models/` (profiles and competence), `lib/pipeline/reply-validator-set.ts`, `eval/blind/`, `eval/error-analysis/`, `docs/eval/failure-modes.md`.

## 1. Error analysis

### Error analysis came after the build, not before
**Status:** Problem existed, now fixed. The failure categories in the plan were brainstormed (eight archetypes), and the first harness measured agreement only.
**Fix (done):** An open-coding pass over real pipeline traces produced the observed categories (`docs/eval/failure-modes.md`). It found the one failure that moves money, and led to two guards. It should be re-run after every change to the profiles, prompts or policy (see 6).

### Failure categories are now observed, not brainstormed
**Status:** OK. They are named after what happened ("claim check says no file matches although the file changed"), not generic labels.

## 2. Evaluator design

### Label agreement alone is a vanity-prone headline
**Status:** Problem existed, fixed. About two thirds of the graded Checkpoints are `delivered`, so a pipeline that labels everything `delivered` scores near 66% while missing every failure; and a pipeline that sends every doubt to a person can look accurate on money while doing no work.
**Fix (done):** Reports now carry per-Label recall, **money-weighted error** (cents over- and under-credited), and **human load** (Cases and Checkpoints sent to a person), shown beside agreement on the Eval page and in `docs/eval/results.md`.

### Exact-credit match can be gamed by deferring to a person
**Status:** Problem exists, mitigated. Model B's exact-credit match is 95% in one run, yet 17 of 20 Cases need a person; many expected Credits are $0, which an `unknown` also prices at $0.
**Fix (done):** Human load is reported beside it. **Deferred:** a single "automation rate" (share of Cases approvable with no person) as a headline; it needs a decision on what an acceptable human load is, which belongs to the Support team that would own the policy.

### Circularity: the Simulated models read the same rubric the rules encode
**Status:** Problem exists and cannot be removed without real models (ADR 0002).
**Mitigations (done):** the error profiles are rates only and a test proves no model source reads expected answers; the expected answers were committed before any data existed; a blind labeler checked the rubric on 10 sessions (93.3% simulated agreement, 3 disagreements resolved, `docs/eval/blind-labeler.md`); the two new guards key on Checkpoint fields (a failed test, missing files), not on the simulators' own heuristics.
**Deferred:** measuring against real model output. Every figure is tagged simulated for this reason, and the README says the eval measures harness robustness, not accuracy.

## 3. Judge validation

### No LLM judge exists; the one validator is code
**Status:** OK by design (ADR 0002). The reply validator is a code check and is measured with true positive and true negative rates, not accuracy.

### The reply validator was tested mostly on its own defect generator
**Status:** Problem existed, partly fixed. Most bad replies came from the same template functions Simulated model B uses to inject defects, so a 100% score was close to circular.
**Fix (done):** 14 replies written by hand in different words (4 good, 10 bad covering cash, fault, promises, invented numbers, a missing line and a missing total) are added per eligible Decision, so the set now has 256 to 265 bad and 112 to 116 good replies. The validator still scores 100% and 100%.
**Deferred:** the hand-written replies were written knowing the validator's rules, so they are not held-out data. A real check needs replies from a real model, or written by a person who has not read the validator.

## 4. Human review process

### There is no human reviewer
**Status:** Problem exists, disclosed. The blind labeler and the annotator are subagents. The blind labeler was instructed to read only its packet but filesystem isolation was not enforced. No domain expert reviewed anything, and the interactive review interface from `error-discovery` was not built.
**Fix:** none possible inside this project's constraints. Every result from these passes is tagged "simulated" and is never reported as human inter-rater agreement. **Deferred:** a real specialist labeling the same 10 sessions from `docs/rubric.md`.

## 5. Labeled data

### Twenty Graded sessions is small
**Status:** Problem exists. 91 graded Checkpoints and 20 Cases give wide uncertainty, and one run is one draw of a Simulated model's mistakes: model A's exact-credit match ranges from 85% to 100% across seeds.
**Fix (done):** `bun run eval` now sweeps 20 extra seeds and reports mean, min and max; the hard metrics must hold on every seed (they do: 0 of 20 seeds failed for either model).
**Deferred:** more Graded sessions. The ~100 trace saturation target is met by the 1,820 graded Checkpoints per model in the error-analysis run, but those are repeated draws over the same 20 sessions, not 100 independent sessions.

## 6. Pipeline hygiene

### Re-run after change
**Status:** Partly in place. The eval command exits non-zero on a hard failure, so it can gate a deploy, and it was re-run after the guards (before and after counts are in the failure-mode document). Nothing runs it automatically.
**Deferred:** wiring it into CI. The README lists it in the deploy checklist.

## Headline targets

Both models are measured with the same stored reports (`docs/eval/results.md`).

| Target | Model A | Model B |
| --- | --- | --- |
| Label agreement at least 85% | **Met** (92.3% single run, 90.2% mean over 20 seeds) | **Documented gap** (68.1% single run, 69.2% mean, range 62.6% to 78.0%) |
| Exact-credit match at least 90% | **Met** (100% single run, 96.0% mean) | **Met on average, not on every seed** (95.0% single run, 90.8% mean, minimum 80.0%) |
| Uncited Labels reaching the UI exactly 0 | **Met** on every seed | **Met** on every seed |
| Injection resistance 100% | **Met** on every seed | **Met** on every seed, despite the injection-susceptible profile |
| Simulated p50 latency under 20 s | **Met** (9.3 s) | **Met** (3.6 s) |
| Second-model rerun within 25 points | **Met, narrowly** (24.2 points apart) | |

**Documented gap, model B label agreement.** Model B is the cheap model with a deliberately higher error rate, so its label agreement is expected to be lower. The target is not met and is not redefined to pass. The guards keep its mistakes from moving money (0 over-credited), at the cost of sending 17 of 20 Cases to a person. A real cheap model would need its own profile measured, and the 85% target and the 0.6 confidence threshold are draft policy numbers a Support team would set.
