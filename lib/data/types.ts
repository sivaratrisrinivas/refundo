import type { Mode } from "@/lib/policy/types";

export type TicketStance =
  | "calm" | "frustrated" | "chargeback_threat" | "vague"
  | "injection_attempt" | "about_the_wrong_thing" | "duplicate_of_credited_session";

export interface Plant {
  claim?: "verified" | "contradicted_by_test" | "unverifiable" | "none" | "plan";
  test?: "pass" | "fail" | "not_run";
  failedStep?: string;
  claimTopic?: string;
  rollbackAfterMin?: number;
  userRollbackAfterMin?: number;
  errorGroup?: string;
  files?: number;
  requestClass?: "style" | "fix" | "feature" | "refactor";
  request?: string;
  incident?: string;
  bugSignature?: string;
  planMode?: boolean;
  noEvidence?: boolean;
  repeat?: number;
}

export interface CheckpointPlan {
  mode: Mode;
  costCents: number;
  plant: Plant;
}

export interface DatasetAccount {
  id: string; name: string; plan: "core" | "pro" | "enterprise"; tenureDays: number;
  creditsGranted30dCents: number; priorDisputes: number; orbCustomerId: string; situation: string;
}
export interface DatasetSession {
  id: string; accountId: string; startedAt: string; totalCostCents: number; failurePattern: string; graded: boolean;
}
export interface DatasetCheckpoint {
  id: string; sessionId: string; seq: number; ts: string; mode: Mode; model: string;
  reasoningEffort: "low" | "medium" | "high"; costCents: number; requestText: string; agentClaimText: string;
  filesChanged: string[]; linesAdded: number; linesRemoved: number;
  appTest: { ran: boolean; passed: boolean | null; failedSteps: string[] };
  rolledBackAt: string | null; errorText: string | null; errorSignature: string | null;
  orbBlockId: string; planMode: boolean;
}
export interface DatasetTicket {
  id: string; accountId: string; sessionId: string | null; subject: string; body: string; tags: string[];
  piId: string; disputeThreatened: boolean; createdAt: string; status: "open";
}
export interface DatasetDecision {
  id: string; ticketId: string; sessionId: string; amountCents: number; approvedOn: string; approver: string;
}
export interface Dataset {
  accounts: DatasetAccount[];
  sessions: DatasetSession[];
  checkpoints: DatasetCheckpoint[];
  tickets: DatasetTicket[];
  incidents: import("./entities").IncidentSeed[];
  bugSignatures: import("./entities").BugSeed[];
  /** Earlier approved Credits (the already-credited session behind E16). */
  priorDecisions: DatasetDecision[];
}

export interface TextOverrides {
  checkpoints?: Record<string, { requestText: string; agentClaimText: string }>;
  tickets?: Record<string, { subject: string; body: string }>;
}
