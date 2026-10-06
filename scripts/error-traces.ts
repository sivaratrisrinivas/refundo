import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadDatasetFile, seedDb } from "@/lib/data/seed";
import { createTestDb } from "@/lib/db/client";
import { classifyFailure, type FailureMode, type MismatchTrace } from "@/lib/eval/failure-modes";
import { loadExpected } from "@/lib/eval/run";
import { getProvider, type ModelName } from "@/lib/models";
import { runCase } from "@/lib/pipeline/run";

// Collect every wrong Checkpoint over many seeds, count failure modes per model, and sample traces for open coding.
const SEEDS = Number(process.argv[2] ?? 20);
const data = loadDatasetFile();
const expected = loadExpected();
const cps = new Map(data.checkpoints.map((c) => [c.id, c]));

interface Trace extends MismatchTrace {
  mode: FailureMode;
  sessionId: string;
  request: string;
  claim: string;
  files: string[];
  appTest: unknown;
  claims: unknown;
}
const traces: Trace[] = [];
const counts: Record<string, Record<string, number>> = {};
const totals: Record<string, { checkpoints: number; wrong: number; seeds: number; stepFailures: Record<string, number> }> = {};

for (const model of ["sim-a", "sim-b"] as ModelName[]) {
  counts[model] = {};
  totals[model] = { checkpoints: 0, wrong: 0, seeds: SEEDS, stepFailures: {} };
  for (let i = 0; i < SEEDS; i++) {
    const seed = `ea-${i}`;
    const db = createTestDb();
    seedDb(db, data);
    for (const s of expected.sessions) {
      const d = await runCase(db, s.ticketId, { provider: getProvider(model), seed });
      for (const t of d.trace.filter((x) => !x.ok)) totals[model]!.stepFailures[t.step] = (totals[model]!.stepFailures[t.step] ?? 0) + 1;
      for (const e of s.checkpoints.filter((c) => !c.excluded)) {
        totals[model]!.checkpoints++;
        const id = `${s.sessionId}-c${e.seq}`;
        const l = d.labels.find((x) => x.checkpointId === id);
        const finalLabel = l?.label ?? "unresolved";
        if (finalLabel === e.label) continue;
        totals[model]!.wrong++;
        const base: MismatchTrace = {
          model, seed, checkpointId: id, expectedLabel: e.label!, finalLabel, source: l?.source ?? null,
          confidence: l?.confidence ?? null, note: l?.note ?? null, humanPrompt: l?.humanPrompt ?? null,
        };
        const mode = classifyFailure(base);
        counts[model]![mode] = (counts[model]![mode] ?? 0) + 1;
        const c = cps.get(id)!;
        traces.push({ ...base, mode, sessionId: s.sessionId, request: c.requestText, claim: c.agentClaimText, files: c.filesChanged, appTest: c.appTest, claims: l?.claims ?? null });
      }
    }
  }
}

mkdirSync("eval/error-analysis", { recursive: true });
const resample = process.argv.includes("--resample");
writeFileSync("eval/error-analysis/summary.json", JSON.stringify({ simulated: true, seeds: SEEDS, totals, modeCounts: counts }, null, 2) + "\n");

// A diverse sample for open coding: 18 per model, spread over modes and sessions, plus a few correct traces as a random control.
function pick(model: string, n: number): Trace[] {
  const pool = traces.filter((t) => t.model === model);
  const byMode = new Map<string, Trace[]>();
  for (const t of pool) (byMode.get(t.mode) ?? byMode.set(t.mode, []).get(t.mode)!).push(t);
  const out: Trace[] = [];
  const queues = [...byMode.values()];
  let k = 0;
  while (out.length < n && queues.some((q) => q.length)) {
    const q = queues[k % queues.length]!;
    const t = q.splice(Math.floor((q.length * 0.37) % q.length), 1)[0];
    if (t && !out.some((o) => o.sessionId === t.sessionId && o.seed === t.seed && o.model === t.model && out.filter((x) => x.sessionId === t.sessionId).length > 1)) out.push(t);
    k++;
  }
  return out;
}
const sample = [...pick("sim-a", 18), ...pick("sim-b", 18)].map((t, i) => ({
  traceId: `T${String(i + 1).padStart(2, "0")}`, model: t.model, seed: t.seed, session: t.sessionId, checkpointId: t.checkpointId,
  request: t.request, agentClaim: t.claim, filesChanged: t.files, appTest: t.appTest,
  pipeline: { claimVerdicts: t.claims, finalLabel: t.finalLabel, source: t.source, confidence: t.confidence, note: t.note, humanPrompt: t.humanPrompt },
  referenceLabel: t.expectedLabel,
}));
// The sample the annotator coded is kept: its trace ids are cited in the failure-mode document.
if (resample || !existsSync("eval/error-analysis/sample.jsonl")) writeFileSync("eval/error-analysis/sample.jsonl", sample.map((s) => JSON.stringify(s)).join("\n") + "\n");
console.log(JSON.stringify({ seeds: SEEDS, totals, modeCounts: counts, sampled: sample.length }, null, 1));
