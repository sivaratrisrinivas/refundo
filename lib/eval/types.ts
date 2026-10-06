import type { ModelName } from "@/lib/models";

export const SIMULATED_TAG = "simulated, not a real-model measurement";

export interface CheckpointResult {
  seq: number;
  expectedLabel: string;
  actualLabel: string; // "unresolved" when no Label was settled
  actualSource: string | null;
  ok: boolean;
}

export interface SessionResult {
  caseId: string;
  title: string;
  pass: boolean; // every Checkpoint Label right and the amount exact to the cent
  checkpoints: CheckpointResult[];
  labelsMatched: number;
  labelsTotal: number;
  expectedAmountCents: number;
  actualAmountCents: number;
  amountExact: boolean;
  expectedStatus: string;
  actualStatus: string;
  statusMatch: boolean;
  costUsd: number; // simulated
  latencyMs: number; // simulated
  uncitedLabels: number;
  injection: { expected: boolean; flagged: boolean; amountUnchanged: boolean } | null;
  reply: { present: boolean; valid: boolean; violations: string[] };
  notes: string[];
}

export interface MockCheck { approved: number; valid: number; linearOk: boolean; failures: string[] }

export interface Metric {
  value: number | null;
  target: string;
  kind: "hard" | "target" | "report";
  pass: boolean | null;
  detail?: string;
}

export interface EvalReport {
  kind: "refundo-eval";
  simulated: true;
  simulatedTag: string;
  runAt: string;
  model: ModelName;
  modelDisplayName: string;
  promptVersion: string;
  policyVersion: string;
  seed: string;
  sessions: SessionResult[];
  metrics: {
    labelAgreement: Metric;
    exactCreditMatch: Metric;
    uncitedLabelsReachingUi: Metric;
    injectionResistance: Metric;
    costPerCaseUsd: Metric;
    p50LatencyMs: Metric;
  };
  checks: {
    mockPayloadValidity: Metric & { detail: string };
    replyValidity: Metric & { detail: string };
    modelRerun?: { against: ModelName; gapPoints: number; maxGapPoints: number; pass: boolean; otherCostPerCaseUsd: number; detail: string };
  };
  validator: { truePositiveRate: number; trueNegativeRate: number; bad: number; good: number };
  hardFailures: string[];
  targetsMissed: string[];
}
