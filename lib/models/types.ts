import type { AppTest, EvidenceField, Label } from "@/lib/policy/types";

/** Every LLM step calls one of these tasks through a provider. */
export type Task = "complaint" | "label" | "verify" | "clauses" | "reply";

export const PROMPT_VERSION = "refundo-prompts-2026-10-1";
export const TASK_PROMPT_ID: Record<Task, string> = {
  complaint: "P1",
  label: "P2",
  verify: "P3",
  clauses: "P4",
  reply: "P5",
};

export type ClaimStatus = "verified" | "contradicted" | "unverifiable";
export interface ClaimVerdict {
  claim: string;
  status: ClaimStatus;
  evidence: string;
}

// --- Task inputs (what a model is allowed to see; never money) -------------

export interface ComplaintInput {
  /** Ticket text, always wrapped as data by the caller. */
  ticketText: string;
}

export interface LabelInputCheckpoint {
  id: string;
  seq: number;
  ts: string;
  mode: string;
  planMode: boolean;
  requestText: string;
  agentClaimText: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  appTest: AppTest;
  rolledBackAt: string | null;
  errorText: string | null;
  /** Deterministic flags from the signal step, e.g. "scope_ratio:12". */
  flags: string[];
  /** Claim verdicts from the verify step, when it ran. */
  claims?: ClaimVerdict[];
}
export interface LabelInput {
  checkpoints: LabelInputCheckpoint[];
}

export interface VerifyInputCheckpoint {
  id: string;
  agentClaimText: string;
  filesChanged: string[];
  appTest: AppTest;
}
export interface VerifyInput {
  checkpoints: VerifyInputCheckpoint[];
}

export interface ClausesInput {
  labels: { checkpointId: string; label: Label }[];
}

export interface ReplyDecision {
  customerFirstName: string;
  sessionId: string;
  amountCents: number;
  subtotalCents: number;
  status: "ready" | "needs_human" | "needs_lead" | "recommend_only";
  lines: { seq: number; label: Label; creditCents: number }[];
  /** Earlier Credit on the same Session, for duplicate Tickets. */
  priorCredit?: { amountCents: number; approvedOn: string };
  routeTo: "account_manager" | null;
  clamped: boolean;
  hasPlanning: boolean;
}
export interface ReplyInput {
  decision: ReplyDecision;
}

// --- Raw outputs (validated by the caller with zod) ------------------------

export interface RawLabel {
  checkpointId: string;
  label: string;
  evidenceFields: string[];
  confidence: number | string;
}

export interface TaskInputs {
  complaint: ComplaintInput;
  label: LabelInput;
  verify: VerifyInput;
  clauses: ClausesInput;
  reply: ReplyInput;
}

export interface ModelResult {
  /** Raw output. JSON for every task except reply (a string). */
  output: unknown;
  usage: { inputTokens: number; outputTokens: number };
  /** Simulated cost in USD from tokens x the labeled-illustrative price table. */
  costUsd: number;
  /** Simulated latency in ms, recorded and never slept. */
  latencyMs: number;
  simulated: true;
  modelName: string;
  promptVersion: string;
}

export interface CallContext {
  /** Stable seed so reruns reproduce. `attempt` lets a retry draw differently. */
  seed: string;
  attempt?: number;
}

export interface ModelProvider {
  /** Machine name stored on every Decision. */
  readonly name: ModelName;
  readonly displayName: string;
  call<T extends Task>(task: T, input: TaskInputs[T], ctx: CallContext): Promise<ModelResult>;
}

export type ModelName = "sim-a" | "sim-b";
export const MODEL_NAMES: ModelName[] = ["sim-a", "sim-b"];
export const MODEL_LABEL: Record<ModelName, string> = { "sim-a": "Simulated model A (strong)", "sim-b": "Simulated model B (cheap)" };
export const MODEL_LETTER: Record<ModelName, "A" | "B"> = { "sim-a": "A", "sim-b": "B" };

/** Anything that is not a known Simulated model name falls back to model A. */
export function parseModelName(x: unknown): ModelName {
  return MODEL_NAMES.includes(x as ModelName) ? (x as ModelName) : "sim-a";
}

export const VALID_EVIDENCE: EvidenceField[] = [
  "id", "sessionId", "seq", "ts", "mode", "model", "reasoningEffort", "costCents",
  "requestText", "agentClaimText", "filesChanged", "linesAdded", "linesRemoved",
  "appTest", "rolledBackAt", "errorText", "errorSignature", "orbBlockId", "planMode",
  "incident", "bug_signature",
];
