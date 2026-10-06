import { readClaims } from "@/lib/models/competence";
import type { DatasetCheckpoint } from "./types";

const TESTS_PASS = /\b(?:all )?tests? (?:are )?(?:pass(?:es|ed|ing)?|green)\b|\bpassing tests\b/i;

/**
 * Free text must not conflict with the structured fields. Returns a list of
 * contradictions (empty when consistent). `falseCompletion` says whether the
 * Checkpoint is expected to be a false completion (its claim *must* then be
 * contradicted by the evidence; for every other Checkpoint it must not be).
 */
export function findContradictions(c: DatasetCheckpoint, falseCompletion: boolean): string[] {
  const out: string[] = [];
  if (TESTS_PASS.test(c.agentClaimText) && c.appTest.passed === false) {
    out.push(`claims tests pass but the test run failed (${c.appTest.failedSteps.join(", ")})`);
  }
  if (c.planMode && !/\bplan\b/i.test(c.agentClaimText)) out.push("Plan Mode Checkpoint whose claim is not a plan");
  if (c.planMode && c.filesChanged.length > 0) out.push("Plan Mode Checkpoint with changed files");
  if (!c.planMode && c.agentClaimText === "" && (c.appTest.ran || c.filesChanged.length > 0)) {
    out.push("empty claim on a Checkpoint with evidence");
  }
  const contradicted = readClaims({
    id: c.id, agentClaimText: c.agentClaimText, filesChanged: c.filesChanged, appTest: c.appTest,
  }).filter((v) => v.status === "contradicted");
  if (falseCompletion && contradicted.length === 0) out.push("expected a contradicted claim but every claim checks out");
  if (!falseCompletion && contradicted.length > 0) {
    out.push(`claim contradicted by the evidence: ${contradicted.map((v) => v.evidence).join("; ")}`);
  }
  return out;
}

/** Word-set Jaccard similarity, for near-duplicate detection. */
export function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z']+/g) ?? []);
  const A = words(a), B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / (A.size + B.size - inter || 1);
}
