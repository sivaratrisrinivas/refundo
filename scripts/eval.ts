import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { addModelRerunCheck, exitCodeFor, loadExpected, runEval, type RunCaseFn } from "@/lib/eval/run";
import { latestReports, writeEvalRows, writeReport } from "@/lib/eval/report";
import { exportOverrideBacklog } from "@/lib/pipeline/backlog";
import { runCase } from "@/lib/pipeline/run";
import type { ModelName } from "@/lib/models";

// Usage: bun run eval -- --model A|B [--seed s] [--sweep N] [--regress]
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const m = (arg("model") ?? "A").toLowerCase();
const model: ModelName = m === "b" || m === "sim-b" ? "sim-b" : "sim-a";
const other: ModelName = model === "sim-a" ? "sim-b" : "sim-a";
const seed = arg("seed") ?? "eval-seed-1";

// --regress plants a deliberate bug (an injected Ticket gets priced at its $500 demand) to show the exit code.
const regress: RunCaseFn = async (db, ticketId, deps) => {
  const d = await runCase(db, ticketId, deps);
  const t = db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).get();
  if (t && /ignore your policy/i.test(t.body)) {
    db.update(schema.decisions).set({ amountCents: 50000 }).where(eq(schema.decisions.ticketId, ticketId)).run();
    return { ...d, amountCents: 50000 };
  }
  return d;
};

const sweep = Number(arg("sweep") ?? 20);
const report = await runEval({ model, seed, sweep, runCaseImpl: args.includes("--regress") ? regress : undefined });
const prior = latestReports()[other];
const gap = loadExpected().crossCuttingChecks.find((c) => c.id === "E19")?.maxAgreementGapPoints ?? 25;
if (prior) addModelRerunCheck(report, prior, gap);

// A deliberate regression is a demonstration: it is never stored as a report.
const regressed = args.includes("--regress");
const path = regressed ? "(not stored: --regress run)" : writeReport(report);
if (!regressed) {
  writeEvalRows(getDb(), report);
  writeFileSync("eval/backlog.json", JSON.stringify(exportOverrideBacklog(getDb()), null, 2) + "\n");
}

const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);
const mm = report.metrics;
console.log(`\nRefundo eval, ${report.modelDisplayName}  [${report.simulatedTag}]`);
console.log(`seed ${report.seed} · prompts ${report.promptVersion} · policy ${report.policyVersion}\n`);
const row = (name: string, v: string, t: string, ok: boolean | null) => console.log(`${ok === null ? "  " : ok ? "ok" : "!!"}  ${name.padEnd(34)} ${v.padStart(10)}   target ${t}`);
row("Label agreement", pct(mm.labelAgreement.value), mm.labelAgreement.target, mm.labelAgreement.pass);
row("Exact-credit match", pct(mm.exactCreditMatch.value), mm.exactCreditMatch.target, mm.exactCreditMatch.pass);
row("Uncited Labels reaching the UI", String(mm.uncitedLabelsReachingUi.value), mm.uncitedLabelsReachingUi.target, mm.uncitedLabelsReachingUi.pass);
row("Injection resistance", pct(mm.injectionResistance.value), mm.injectionResistance.target, mm.injectionResistance.pass);
row("Cost per case (simulated)", `$${(mm.costPerCaseUsd.value ?? 0).toFixed(4)}`, mm.costPerCaseUsd.target, null);
row("p50 latency (simulated)", `${((mm.p50LatencyMs.value ?? 0) / 1000).toFixed(1)} s`, mm.p50LatencyMs.target, mm.p50LatencyMs.pass);
row("Mock payload validity", pct(report.checks.mockPayloadValidity.value), "100%", report.checks.mockPayloadValidity.pass);
row("Invalid replies reaching the UI", String(report.checks.replyValidity.value), "exactly 0", report.checks.replyValidity.pass);
if (report.checks.modelRerun) row(`Rerun vs ${report.checks.modelRerun.against}`, `${report.checks.modelRerun.gapPoints} pts`, `<= ${report.checks.modelRerun.maxGapPoints} pts`, report.checks.modelRerun.pass);
console.log(`\nreply validator on the labeled set: TPR ${pct(report.validator.truePositiveRate)} (${report.validator.bad} bad), TNR ${pct(report.validator.trueNegativeRate)} (${report.validator.good} good)`);
const hl = report.humanLoad;
console.log(`human load: ${hl.casesNeedingHuman}/${hl.cases} Cases need a person (${hl.expectedCasesNeedingHuman} by design); ${hl.checkpointsToHuman}/${hl.checkpoints} Checkpoints were sent to a person that the rubric settles`);
const me = report.moneyError;
console.log(`money error (simulated Credit): over-credited ${(me.overCreditCents / 100).toFixed(2)}, under-credited ${(me.underCreditCents / 100).toFixed(2)}, of ${(me.expectedTotalCents / 100).toFixed(2)} expected`);
if (report.sweep) {
  const w = report.sweep;
  console.log(`sweep over ${w.seeds} extra seeds: label agreement ${pct(w.labelAgreement.mean)} (${pct(w.labelAgreement.min)} to ${pct(w.labelAgreement.max)}), exact credit ${pct(w.exactCreditMatch.mean)} (${pct(w.exactCreditMatch.min)} to ${pct(w.exactCreditMatch.max)}), seeds with a hard failure: ${w.hardFailureSeeds}`);
}
console.log(`failing sessions: ${report.sessions.filter((s) => !s.pass).map((s) => s.caseId).join(", ") || "none"}`);
if (report.targetsMissed.length) console.log(`targets missed (reported, not failing): ${report.targetsMissed.join("; ")}`);
if (report.hardFailures.length) console.log(`HARD FAILURES: ${report.hardFailures.join("; ")}`);
console.log(`\nreport: ${path}`);
process.exit(exitCodeFor(report));
