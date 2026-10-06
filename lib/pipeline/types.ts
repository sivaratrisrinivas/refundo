import type { CheckpointLabel, Checkpoint, Label, Plan } from "@/lib/policy/types";
import type { CreditLine, DecisionStatus, CapStatus } from "@/lib/policy/engine";

export interface CaseAccount {
  id: string; name: string; plan: Plan; tenureDays: number; creditsGranted30dCents: number;
  priorDisputes: number; orbCustomerId: string;
}
export interface CaseTicket {
  id: string; accountId: string; sessionId: string | null; subject: string; body: string; tags: string[];
  piId: string | null; disputeThreatened: boolean; createdAt: string; status: string;
}
export interface CaseIncident { id: string; title: string; startsAt: string; endsAt: string; sourceUrl: string }
export interface CaseBugSignature { id: string; name: string; pattern: string; linearIssueRef: string }

/** Everything the pipeline may read. Note: no Failure pattern, ever. */
export interface CaseData {
  ticket: CaseTicket;
  account: CaseAccount;
  session: { id: string; startedAt: string; totalCostCents: number } | null;
  checkpoints: Checkpoint[];
  incidents: CaseIncident[];
  bugSignatures: CaseBugSignature[];
  priorCredit: { amountCents: number; approvedOn: string } | null;
}

/** A Label as stored on a Decision: the final one for a Checkpoint. */
export type LabelRecord = CheckpointLabel & {
  /** Set when the Label was replaced by `unknown` and a person must decide. */
  humanPrompt?: string;
  /** Claim verdicts from the verify step, shown in the evidence drawer. */
  claims?: { claim: string; status: "verified" | "contradicted" | "unverifiable"; evidence: string }[];
};

export interface Override {
  kind: "label" | "amount";
  checkpointId?: string;
  from: string | number;
  to: string | number;
  reason: string;
  actor: string;
  ts: string;
}

export interface TraceStep {
  step: string;
  ok: boolean;
  note?: string;
  attempts?: number;
  costUsd?: number;
  latencyMs?: number;
  model?: string;
}

export interface DecisionRecord {
  id: string;
  ticketId: string;
  sessionId: string | null;
  labels: LabelRecord[];
  clauses: string[];
  lines: CreditLine[];
  amountCents: number;
  subtotalCents: number;
  capStatus: CapStatus | "none";
  status: DecisionStatus | "approved";
  needsHuman: boolean;
  needsLead: boolean;
  routeTo: "account_manager" | null;
  fileLinear: boolean;
  approver: string | null;
  overrideReason: string | null;
  overrides: Override[];
  policyVersion: string;
  modelName: string;
  promptVersion: string;
  injectionDetected: boolean;
  complaint: unknown;
  reply: string | null;
  notes: string[];
  unresolved: string[];
  priorCredit: { amountCents: number; approvedOn: string } | null;
  trace: TraceStep[];
  costUsd: number;
  latencyMs: number;
  ceilingCents: number | null;
  headroomCents: number | null;
  createdAt: string;
  approvedAt: string | null;
}

export type { Label };
