# Failure modes of the Simulated models

> **Simulated.** The traces come from two Simulated models with declared error profiles, and the annotator was a subagent, not a person. These are failure modes of the *harness under simulated mistakes*, not of any real model.

## How they were found

1. **Traces.** `bun run error-traces` ran the full pipeline on the 20 Graded sessions for each Simulated model over 20 seeds (1820 graded Checkpoints per model) and kept every Checkpoint whose final Label differed from the expected one.
2. **Open coding.** A separate subagent (the *simulated annotator*) read a sample of 36 wrong results, 18 per model, chosen to spread across modes (`eval/error-analysis/sample.jsonl`), and wrote one observation per trace with no taxonomy in hand, then proposed categories (`eval/error-analysis/open-codes.json`). It read only the sample file.
3. **Axial coding.** Its eight categories were mapped to the classifier in `lib/eval/failure-modes.ts` so every wrong Checkpoint over all seeds could be counted. The mapping: `claim_check_false_contradiction` is `false_credit_from_flipped_claim`; `labeler_proposal_overruled_by_claim_check` is `claim_check_conflict_unknown`; `citation_check_rejects_proposal` is the two citation modes; `confidence_threshold_too_strict` is `low_confidence_unknown`; `failed_test_ignored_unverifiable_claim_accepted` is `missed_false_completion`; `pipeline_no_output` is `schema_failure_needs_human`; `clean_evidence_no_rule_fires` is `model_unknown_answer` (the model said `unknown`, and the annotator saw no note explaining it); `vague_claim_unverifiable` is not a separate mode but an amplifier: borderline claims lower the model's confidence, so they feed `low_confidence_unknown` and the citation modes.

The annotator did not build a review interface; the error-discovery skill's interactive UI was skipped because no person is reviewing. A real review would use one (`build-review-interface`).

## What went wrong, before and after the guards

Counts are wrong Checkpoints over 20 seeds (166 wrong of 1820 for model A, 579 of 1820 for model B after the guards). Each cell reads **before the two guards → after**.

| Failure mode | What happens | Moves money? | Model A | Model B |
| --- | --- | --- | --- | --- |
| `low_confidence_unknown` | Answer under the 0.6 confidence minimum; the Checkpoint goes to a person. | no, a person decides | 47 → 47 | 107 → 107 |
| `invalid_citation_unknown` | The model cited a field that does not exist; the citation validator turns it into `unknown`. | no, a person decides | 24 → 24 | 101 → 101 |
| `missing_citation_unknown` | A verdict with no citation at all; becomes `unknown`. | no, a person decides | 14 → 14 | 63 → 63 |
| `claim_check_conflict_unknown` | The Labeler and the claim verifier disagree; the consistency guard sends it to a person. | no, a person decides | 13 → 13 | 66 → 66 |
| `model_unknown_answer` | The model itself answered `unknown` where the rubric settles the Checkpoint. | no, a person decides | 34 → 34 | 124 → 124 |
| `schema_failure_needs_human` | Malformed output twice in a row; the step fails and the Case goes to a person. | no, a person decides | 0 → 0 | 17 → 17 |
| `false_credit_from_flipped_claim` | The claim verifier wrongly marked a verified claim contradicted, the Labeler agreed, and the Checkpoint was credited as a false completion. | **yes, over-credit** | 34 → 0 | 99 → 0 |
| `missed_false_completion` | A contradicted claim was missed and the Checkpoint was labeled `delivered` over a failed test. | **yes, under-credit** | 0 → 0 | 2 → 0 |
| `weak_evidence_confirm_unknown` | (new guard) A false completion that rests on missing files alone, with every test passing, now waits for a person. | no, a person decides | 0 → 34 | 0 → 99 |
| `failed_test_guard_unknown` | (new guard) `delivered` over a failed test is sent to a person. | no, a person decides | 0 → 0 | 0 → 2 |

### The finding that changed the pipeline

Before the guards, the most important failure was not the most common one. `false_credit_from_flipped_claim` is the only mode where a Simulated-model mistake turned directly into Credit nobody earned (34 Checkpoints for model A, 99 for model B over the run), and `missed_false_completion` is the mirror image. The annotator flagged seven of its 36 traces as money-risky, and all seven were of these two kinds (five flipped claims, two missed false completions).

Two guards, both based on Checkpoint fields rather than on the model's reasoning, close them:

- **`delivered` over a failed test goes to a person.** A model may not call a Checkpoint delivered when a test failed on it.
- **A false completion that rests on missing files alone goes to a person.** Auto-credit needs a failed test step as evidence; otherwise a person confirms (an Override with a reason) before money moves.

Effect on the eval (single run, seed `eval-seed-1`, from the stored reports): model A's over-credit fell from $14.50 to $0.00, model B's from $58.60 to $0.00, and B's exact-credit match rose from 65.0% to 95.0%.

**The price is human work.** The guards turn doubt into review: label agreement is unchanged or lower and more Cases need a person (see `docs/eval/results.md`, "Human load"). That is the intended trade for a money system, and it is why human load is a headline figure beside agreement.

### What is left

- `low_confidence_unknown`, the two citation modes and `model_unknown_answer` are the volume: they are cheap mistakes (a person decides) but they set the human load. The 0.6 threshold is a draft policy number; the annotator thought it too strict on borderline claims. Tuning it needs real-model confidence data, which this project does not have (ADR 0002).
- Model B's step failures over the run (malformed output twice): draft reply 13, extract complaint 6, verify claims 2, label 2. Every one routed to a person; none moved money.
- Real models will fail differently. The profiles here are assumptions written down in `lib/models/profiles.json`.
