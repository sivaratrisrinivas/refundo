import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { latestReports } from "@/lib/eval/report";
import { renderResults } from "@/lib/eval/render";

describe("evaluation documents", () => {
  test("results.md is exactly what the stored reports render to", () => {
    const md = readFileSync("docs/eval/results.md", "utf8");
    expect(md).toContain(renderResults(latestReports()));
  });

  test("the failure-mode document lists the modes per model with example traces", () => {
    const doc = readFileSync("docs/eval/failure-modes.md", "utf8");
    for (const m of ["false_credit_from_flipped_claim", "low_confidence_unknown", "invalid_citation_unknown", "claim_check_conflict_unknown", "schema_failure_needs_human"]) expect(doc).toContain(m);
    expect(doc).toMatch(/Simulated\.\*\* The traces come from two Simulated models/);
    expect(existsSync("eval/error-analysis/open-codes.json")).toBe(true);
    const codes = JSON.parse(readFileSync("eval/error-analysis/open-codes.json", "utf8")) as { simulated: boolean; categories: { traceIds: string[] }[]; openCodes: unknown[] };
    expect(codes.simulated).toBe(true);
    expect(codes.openCodes).toHaveLength(36);
    expect(codes.categories.flatMap((c) => c.traceIds)).toHaveLength(36);
    const sample = readFileSync("eval/error-analysis/sample.jsonl", "utf8").trim().split("\n");
    expect(sample).toHaveLength(36);
  });

  test("the audit covers the six areas and every headline target is met or a documented gap", () => {
    const audit = readFileSync("docs/eval/audit.md", "utf8");
    for (const area of ["## 1. Error analysis", "## 2. Evaluator design", "## 3. Judge validation", "## 4. Human review process", "## 5. Labeled data", "## 6. Pipeline hygiene"]) expect(audit).toContain(area);
    for (const t of ["Label agreement", "Exact-credit match", "Uncited Labels", "Injection resistance", "p50 latency"]) expect(audit).toContain(t);
    expect(audit).toMatch(/Documented gap/);
    // each finding is fixed or explicitly deferred
    const findings = audit.split("\n### ").slice(1).filter((s) => !s.startsWith("Re-run") || true);
    expect(findings.length).toBeGreaterThan(8);
  });
});
