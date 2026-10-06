export type Mode = "free" | "power" | "max";

export interface AppTest {
  ran: boolean;
  passed: boolean | null;
  failedSteps: string[];
}

/** One billed unit of Agent work. Money is integer cents. */
export interface Checkpoint {
  id: string;
  sessionId: string;
  seq: number;
  ts: string; // ISO
  mode: Mode;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  costCents: number; // 0 in free mode
  requestText: string;
  agentClaimText: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  appTest: AppTest;
  rolledBackAt: string | null;
  errorText: string | null;
  errorSignature: string | null; // normalized hash derived from errorText
  orbBlockId: string;
  planMode: boolean;
}

export const LABELS = [
  "delivered",
  "reverted_after_fail",
  "loop",
  "false_completion",
  "scope_overrun",
  "incident_overlap",
  "known_bug",
  "user_choice_rollback",
  "planning",
  "unknown",
] as const;
export type Label = (typeof LABELS)[number];

/** Most specific first. A Checkpoint is never credited twice. */
export const LABEL_PRECEDENCE: readonly Label[] = [
  "known_bug",
  "incident_overlap",
  "reverted_after_fail",
  "loop",
  "false_completion",
  "scope_overrun",
  "user_choice_rollback",
  "planning",
  "delivered",
];

export type EvidenceField = keyof Checkpoint | "incident" | "bug_signature";

export type LabelSource = "rule" | "model" | "human";

export interface CheckpointLabel {
  checkpointId: string;
  label: Label;
  evidenceFields: EvidenceField[];
  source: LabelSource;
  confidence: number; // 0..1, rules = 1
  /** 1-based position of this Checkpoint in a run of repeated errors (loop only). */
  repeat?: number;
  /** Free-text note shown in the UI, e.g. "repeat 1 of 3". Never read by the engine. */
  note?: string;
  /** Secondary matches that lost on precedence, kept as evidence. */
  alsoMatched?: Label[];
  /** Required on a human Override. */
  overrideReason?: string;
}

export type ClauseId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8";
export type Plan = "core" | "pro" | "enterprise";
