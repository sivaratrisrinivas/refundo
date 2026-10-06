import type { ZodType } from "zod";
import type { CallContext, ModelProvider, Task, TaskInputs } from "@/lib/models";
import { VALID_EVIDENCE } from "@/lib/models";
import { labelSchema, verifySchema, type LabelOutput, type VerifyOutput } from "@/lib/models/schemas";
import type { Checkpoint, CheckpointLabel, EvidenceField } from "@/lib/policy/types";
import type { LabelRecord, TraceStep } from "./types";

export interface StepOutcome<T> {
  value: T | null;
  trace: TraceStep;
}

/** Call a model, validate with zod, retry once on a schema mismatch, then give up. */
export async function callValidated<K extends Task, T>(
  provider: ModelProvider, task: K, input: TaskInputs[K], ctx: CallContext, schema: ZodType<T>, step: string,
): Promise<StepOutcome<T>> {
  let costUsd = 0, latencyMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await provider.call(task, input, { ...ctx, attempt });
    costUsd += r.costUsd;
    latencyMs += r.latencyMs;
    const parsed = schema.safeParse(r.output);
    if (parsed.success) {
      return { value: parsed.data, trace: { step, ok: true, attempts: attempt + 1, costUsd, latencyMs, model: r.modelName } };
    }
  }
  return {
    value: null,
    trace: { step, ok: false, attempts: 2, costUsd, latencyMs, model: provider.name, note: "schema mismatch twice; routed to a human" },
  };
}

export function toVerifyInput(cps: Checkpoint[]): TaskInputs["verify"] {
  return { checkpoints: cps.map((c) => ({ id: c.id, agentClaimText: c.agentClaimText, filesChanged: c.filesChanged, appTest: c.appTest })) };
}

export type ClaimsByCp = Map<string, VerifyOutput[number]["claims"]>;

/** Unverifiable is never upgraded: a "verified" verdict with no evidence is downgraded. */
export function normalizeClaims(out: VerifyOutput): ClaimsByCp {
  const m: ClaimsByCp = new Map();
  for (const o of out) {
    m.set(
      o.checkpointId,
      o.claims.map((c) =>
        c.status === "verified" && c.evidence.trim() === "" ? { ...c, status: "unverifiable" as const } : c,
      ),
    );
  }
  return m;
}

export function toLabelInput(
  cps: Checkpoint[], flags: Map<string, string[]>, claims: ClaimsByCp,
): TaskInputs["label"] {
  return {
    checkpoints: cps.map((c) => ({
      id: c.id, seq: c.seq, ts: c.ts, mode: c.mode, planMode: c.planMode, requestText: c.requestText,
      agentClaimText: c.agentClaimText, filesChanged: c.filesChanged, linesAdded: c.linesAdded,
      linesRemoved: c.linesRemoved, appTest: c.appTest, rolledBackAt: c.rolledBackAt, errorText: c.errorText,
      flags: flags.get(c.id) ?? [], claims: claims.get(c.id),
    })),
  };
}

const CHECKPOINT_FIELDS = new Set<string>(VALID_EVIDENCE.filter((f) => f !== "incident" && f !== "bug_signature"));

export const UNCITED_PROMPT = "The model's Label cited evidence that does not exist on this Checkpoint. Choose a Label and give a reason.";
export const LOW_CONFIDENCE_PROMPT = "The model was not confident enough to decide this Checkpoint. Choose a Label and give a reason.";
export const FAILED_TEST_PROMPT = "A test failed on this Checkpoint but the model said it was delivered. Choose a Label and give a reason.";
export const WEAK_EVIDENCE_PROMPT = "The model called this a false completion on file evidence alone (no failed test). Confirm or choose another Label, with a reason.";
export const CONFLICT_PROMPT = "The model's Label disagrees with the claim evidence. Choose a Label and give a reason.";

/**
 * Citation validator and consistency guard. A Label survives only if every cited
 * field exists on the Checkpoint, at least one is cited, confidence is at least
 * the minimum, and it agrees with the claim verdicts. Anything else becomes
 * `unknown` with a human prompt, so an uncited Label never reaches the UI.
 */
export function validateModelLabel(
  raw: LabelOutput[number], claims: VerifyOutput[number]["claims"] | undefined, minConfidence: number,
  cp?: { appTestPassed: boolean | null },
): LabelRecord {
  const base: CheckpointLabel = {
    checkpointId: raw.checkpointId, label: raw.label, evidenceFields: raw.evidenceFields as EvidenceField[],
    source: "model", confidence: raw.confidence,
  };
  const unknown = (humanPrompt: string, note: string): LabelRecord => ({
    checkpointId: raw.checkpointId, label: "unknown", evidenceFields: [], source: "model", confidence: raw.confidence,
    note, humanPrompt,
  });
  if (raw.label === "unknown") {
    return { ...base, evidenceFields: [], humanPrompt: "No evidence settles this Checkpoint. Choose a Label and give a reason." };
  }
  if (raw.evidenceFields.length === 0 || raw.evidenceFields.some((f) => !CHECKPOINT_FIELDS.has(f))) {
    return unknown(UNCITED_PROMPT, `model proposed ${raw.label} with ${raw.evidenceFields.length === 0 ? "no citation" : "an invalid citation"}`);
  }
  if (raw.confidence < minConfidence) {
    return unknown(LOW_CONFIDENCE_PROMPT, `model proposed ${raw.label} at confidence ${raw.confidence}`);
  }
  const contradicted = (claims ?? []).some((c) => c.status === "contradicted");
  if ((raw.label === "false_completion" && !contradicted) || (raw.label === "delivered" && contradicted)) {
    return unknown(CONFLICT_PROMPT, `model proposed ${raw.label} but the claim check ${contradicted ? "found a contradiction" : "found none"}`);
  }
  // Guards found by error analysis (docs/eval/failure-modes.md), based on Checkpoint fields, not on the model's reasoning:
  // a model may not call a Checkpoint delivered over a failed test, and a false completion that rests on missing files
  // alone, with no failed test, is confirmed by a person before it moves money.
  if (cp && raw.label === "delivered" && cp.appTestPassed === false) {
    return unknown(FAILED_TEST_PROMPT, "model proposed delivered but a test failed on this Checkpoint");
  }
  if (cp && raw.label === "false_completion" && cp.appTestPassed !== false) {
    return unknown(WEAK_EVIDENCE_PROMPT, "model proposed false_completion on file evidence only, with no failed test");
  }
  return base;
}

export { labelSchema, verifySchema };
