/**
 * Failure modes observed in Simulated-model traces. The taxonomy comes from an
 * open-coding pass over real pipeline traces (see docs/eval/failure-modes.md),
 * and this classifier assigns each wrong Checkpoint to one mode so the modes can
 * be counted over many seeds.
 */
export type FailureMode =
  | "low_confidence_unknown"
  | "invalid_citation_unknown"
  | "missing_citation_unknown"
  | "claim_check_conflict_unknown"
  | "failed_test_guard_unknown"
  | "weak_evidence_confirm_unknown"
  | "model_unknown_answer"
  | "false_credit_from_flipped_claim"
  | "missed_false_completion"
  | "schema_failure_needs_human"
  | "other";

export interface MismatchTrace {
  model: string;
  seed: string;
  checkpointId: string;
  expectedLabel: string;
  finalLabel: string; // "unresolved" when nothing was settled
  source: string | null;
  confidence: number | null;
  note: string | null;
  humanPrompt: string | null;
}

export function classifyFailure(t: MismatchTrace): FailureMode {
  if (t.finalLabel === "unresolved") return "schema_failure_needs_human";
  if (t.finalLabel === "unknown") {
    const n = t.note ?? "";
    if (/invalid citation/.test(n)) return "invalid_citation_unknown";
    if (/no citation/.test(n)) return "missing_citation_unknown";
    if (/at confidence/.test(n)) return "low_confidence_unknown";
    if (/claim check/.test(n)) return "claim_check_conflict_unknown";
    if (/a test failed/.test(n)) return "failed_test_guard_unknown";
    if (/file evidence only/.test(n)) return "weak_evidence_confirm_unknown";
    return "model_unknown_answer";
  }
  if (t.finalLabel === "false_completion" && t.expectedLabel === "delivered") return "false_credit_from_flipped_claim";
  if (t.expectedLabel === "false_completion" && t.finalLabel === "delivered") return "missed_false_completion";
  return "other";
}

export const FAILURE_MODE_TEXT: Record<FailureMode, string> = {
  low_confidence_unknown: "The model answered below the 0.6 confidence minimum, so the Checkpoint became `unknown` and went to a person. No money moved.",
  invalid_citation_unknown: "The model cited a field that does not exist on the Checkpoint. The citation validator turned the Label into `unknown`. No money moved.",
  missing_citation_unknown: "The model gave a Label with no citation at all. It became `unknown`. No money moved.",
  claim_check_conflict_unknown: "The Labeler and the claim verifier disagreed (for example `delivered` against a contradicted claim). The consistency guard sent it to a person. No money moved.",
  failed_test_guard_unknown: "The model said `delivered` over a failed test; the guard sent it to a person (it was a real false completion the claim check had missed). No money moved.",
  weak_evidence_confirm_unknown: "The model called a false completion on missing-file evidence alone, with every test passing; the guard asks a person to confirm before any Credit. No money moved (this is the guard that stops a flipped claim becoming an over-credit).",
  model_unknown_answer: "The model itself answered `unknown` for a Checkpoint the rubric settles. No money moved.",
  false_credit_from_flipped_claim: "The claim verifier wrongly marked a verified claim as contradicted, the Labeler agreed, and the Checkpoint was credited as a false completion. Money moved: an over-credit that no guard in code catches.",
  missed_false_completion: "A contradicted claim was marked unverifiable or verified, so a real false completion was labeled `delivered`. Money moved: an under-credit.",
  schema_failure_needs_human: "The model returned malformed output twice. The step failed and the Case went to a person with the Checkpoint unlabeled. No money moved.",
  other: "Not covered by the taxonomy yet.",
};

/** Whether this mode moves money (the ones that matter most). */
export const MONEY_MOVING: ReadonlySet<FailureMode> = new Set(["false_credit_from_flipped_claim", "missed_false_completion", "other"]);
