import type { Label } from "@/lib/policy/types";
import type {
  ClaimVerdict,
  ClausesInput,
  ComplaintInput,
  LabelInput,
  LabelInputCheckpoint,
  VerifyInput,
} from "./types";

/**
 * The "best answer" a Simulated model would give before its error profile is
 * applied. It reads only the task input, never expected answers: a small,
 * transparent reading of the rubric, nothing more. The profile then degrades
 * it (mislabels, bad citations, schema slips) so the harness has something to
 * contain. See ADR 0002.
 */

// --- P1 complaint ----------------------------------------------------------

const GRIEVANCE = /charg|credit|spent|wasted|broke|broken|loop|fail|roll|revert|did not|didn't|not work|cost|\$\d|nothing|still/i;
const TIME_REF =
  /\b(?:yesterday|today|last (?:night|week|month)|this (?:morning|week)|\d+ (?:min(?:ute)?s?|hours?|days?) ago|on (?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
const AMOUNT_REF = /\$\d[\d,]*(?:\.\d{2})?/;
const THREAT = /charge ?back|dispute (?:the |this )?charge|my bank|card company|lawyer|legal action|\bsue\b|small claims/i;
const INJECTION =
  /ignore (?:all |your |the |any )?(?:previous |prior )?(?:instructions|polic(?:y|ies)|rules)|disregard|system prompt|you are now|override (?:the |your )?polic|(?:issue|approve|grant|give) (?:me )?(?:a )?(?:credit of )?\$\d+/i;

export interface ComplaintOutput {
  grievances: { text: string; timeRef?: string; amountRef?: string }[];
  disputeThreat: boolean;
  injectionDetected: boolean;
}

export function readComplaint(input: ComplaintInput): ComplaintOutput {
  const sentences = input.ticketText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let picked = sentences.filter((s) => GRIEVANCE.test(s) && !INJECTION.test(s));
  if (picked.length === 0) picked = sentences.slice(0, 1);
  return {
    grievances: picked.slice(0, 5).map((text) => {
      const g: { text: string; timeRef?: string; amountRef?: string } = { text };
      const t = text.match(TIME_REF)?.[0];
      const a = text.match(AMOUNT_REF)?.[0];
      if (t) g.timeRef = t;
      if (a) g.amountRef = a;
      return g;
    }),
    disputeThreat: THREAT.test(input.ticketText),
    injectionDetected: INJECTION.test(input.ticketText),
  };
}

// --- P3 claim verifier -----------------------------------------------------

const STOP = new Set([
  "fixed", "added", "updated", "implemented", "completed", "finished", "working", "should", "now",
  "the", "and", "with", "that", "this", "from", "have", "been", "made", "your", "also", "into",
  "page", "flow", "feature", "built", "removed", "refactored", "improved", "everything", "works",
  "tests", "test", "pass", "passing", "passes", "done", "code", "app", "all", "for", "you", "are",
]);
const ACTION = /\b(?:fixed|added|implemented|updated|refactored|removed|built|created|resolved|migrated)\b/i;

function keywords(claim: string): string[] {
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

export function splitClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+(?:and|,)\s+(?=(?:fixed|added|implemented|updated|refactored|removed|built|created|resolved|migrated)\b)/i)
    .map((s) => s.trim().replace(/[.!]$/, ""))
    .filter((s) => s.length > 3);
}

export function readClaims(cp: VerifyInput["checkpoints"][number]): ClaimVerdict[] {
  const files = cp.filesChanged.map((f) => f.toLowerCase());
  const failed = cp.appTest.failedSteps.map((s) => s.toLowerCase());
  return splitClaims(cp.agentClaimText).map((claim) => {
    const kws = keywords(claim);
    const failedHit = failed.find((s) => kws.some((k) => s.includes(k)));
    if (failedHit) {
      return { claim, status: "contradicted", evidence: `failed test step "${failedHit}"` };
    }
    const fileHit = files.find((f) => kws.some((k) => f.includes(k)));
    if (fileHit) return { claim, status: "verified", evidence: `changed file ${fileHit}` };
    if (kws.length > 0 && ACTION.test(claim)) {
      return { claim, status: "contradicted", evidence: "no changed file matches this claim" };
    }
    return { claim, status: "unverifiable", evidence: "no file or test step covers this claim" };
  });
}

// --- P2 labeler ------------------------------------------------------------

export interface LabelGuess {
  label: Label;
  evidenceFields: string[];
  confidence: number;
}

export function readCheckpoint(cp: LabelInputCheckpoint): LabelGuess {
  const claims = cp.claims ?? [];
  const noEvidence =
    !cp.appTest.ran && cp.filesChanged.length === 0 && cp.linesAdded + cp.linesRemoved === 0 && !cp.planMode;
  if (noEvidence) return { label: "unknown", evidenceFields: [], confidence: 0.35 };

  const contradicted = claims.filter((c) => c.status === "contradicted");
  if (contradicted.length > 0) {
    const fields = ["agentClaimText"];
    if (cp.appTest.failedSteps.length > 0) fields.push("appTest");
    if (contradicted.some((c) => c.evidence.startsWith("no changed file"))) fields.push("filesChanged");
    return { label: "false_completion", evidenceFields: fields, confidence: 0.92 };
  }
  if (cp.appTest.passed === false) {
    return { label: "unknown", evidenceFields: ["appTest"], confidence: 0.55 };
  }
  if (claims.some((c) => c.status === "unverifiable")) {
    return { label: "delivered", evidenceFields: ["agentClaimText", "filesChanged"], confidence: 0.68 };
  }
  return {
    label: "delivered",
    evidenceFields: cp.appTest.ran ? ["appTest", "filesChanged"] : ["filesChanged", "agentClaimText"],
    confidence: cp.appTest.ran ? 0.93 : 0.78,
  };
}

export function readLabels(input: LabelInput): (LabelGuess & { checkpointId: string })[] {
  return input.checkpoints.map((cp) => ({ checkpointId: cp.id, ...readCheckpoint(cp) }));
}

// --- P4 clause selector ----------------------------------------------------

const CLAUSE_BY_LABEL: Partial<Record<Label, [string, string]>> = {
  reverted_after_fail: ["C2", "rolled back within the window after a failed test"],
  loop: ["C3", "the same error repeated at least three times"],
  false_completion: ["C4", "completion was claimed but the evidence contradicts it"],
  scope_overrun: ["C5", "far more files changed than the request class median"],
  incident_overlap: ["C6", "errored during a public incident"],
  known_bug: ["C7", "matches a known bug signature"],
  user_choice_rollback: ["C8", "rolled back without a failure signal"],
  delivered: ["C1", "delivered work is not credited"],
  planning: ["C1", "planning work is not credited"],
};

export function readClauses(input: ClausesInput): { clauseId: string; reason: string }[] {
  const seen = new Map<string, string>();
  for (const l of input.labels) {
    const hit = CLAUSE_BY_LABEL[l.label];
    if (hit && !seen.has(hit[0])) seen.set(hit[0], hit[1]);
  }
  return [...seen].map(([clauseId, reason]) => ({ clauseId, reason }));
}
