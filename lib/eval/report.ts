import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import type { ModelName } from "@/lib/models";
import type { EvalReport } from "./types";

const DIR = () => join(process.cwd(), "eval/reports");

export function reportFileName(r: EvalReport): string {
  return `${r.runAt.replace(/[:.]/g, "-")}-${r.model}.json`;
}

export function writeReport(r: EvalReport, dir = DIR()): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, reportFileName(r));
  writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
  return path;
}

/** The newest stored report for each Simulated model. */
export function latestReports(dir = DIR()): Partial<Record<ModelName, EvalReport>> {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return {}; }
  const out: Partial<Record<ModelName, EvalReport>> = {};
  for (const f of files) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalReport;
    if (r.kind === "refundo-eval") out[r.model] = r;
  }
  return out;
}

/** One eval row per Case per model, so the Eval page and later analysis can query a run. */
export function writeEvalRows(db: Db, r: EvalReport): void {
  const runId = `${r.runAt}-${r.model}`;
  db.transaction((tx) => {
    for (const s of r.sessions) {
      tx.insert(schema.evalRuns).values({
        id: `${runId}:${s.caseId}`, runId, model: r.model, caseId: s.caseId,
        expected: { amountCents: s.expectedAmountCents, status: s.expectedStatus, labels: s.checkpoints.map((c) => [c.seq, c.expectedLabel]) },
        actual: { amountCents: s.actualAmountCents, status: s.actualStatus, labels: s.checkpoints.map((c) => [c.seq, c.actualLabel]), simulated: true },
        pass: s.pass, costUsd: s.costUsd, latencyMs: s.latencyMs, createdAt: r.runAt,
      }).run();
    }
  });
}
