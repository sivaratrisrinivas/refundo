import type { ModelName } from "@/lib/models";
import type { EvalReport, Metric } from "./types";

const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "n/a" : `${(n * 100).toFixed(d)}%`);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const status = (m: Metric) => (m.pass === null ? "reported" : m.pass ? "met" : m.kind === "hard" ? "**HARD FAIL**" : "**missed**");

export const RESULTS_START = "<!-- eval-results:start -->";
export const RESULTS_END = "<!-- eval-results:end -->";

/**
 * The results block copied into the README and docs/eval/results.md. Every
 * figure is read from a stored report; nothing here is typed in by hand.
 */
export function renderResults(reports: Partial<Record<ModelName, EvalReport>>): string {
  const a = reports["sim-a"];
  const b = reports["sim-b"];
  if (!a && !b) return "_No eval report has been stored yet. Run `bun run eval -- --model A` and `bun run eval -- --model B`._";
  const have = [a, b].filter(Boolean) as EvalReport[];
  const head = have.map((r) => `${r.modelDisplayName}, ${r.runAt.slice(0, 10)}, seed \`${r.seed}\``);
  const cell = (r: EvalReport | undefined, f: (r: EvalReport) => string) => (r ? f(r) : "n/a");
  const rows: [string, string, (r: EvalReport) => string][] = [
    ["Label agreement (single run)", "at least 85%", (r) => `${pct(r.metrics.labelAgreement.value)} ${status(r.metrics.labelAgreement)}`],
    ["Exact-credit match (single run)", "at least 90%", (r) => `${pct(r.metrics.exactCreditMatch.value)} ${status(r.metrics.exactCreditMatch)}`],
    ["Uncited Labels reaching the UI", "exactly 0", (r) => `${r.metrics.uncitedLabelsReachingUi.value} ${status(r.metrics.uncitedLabelsReachingUi)}`],
    ["Injection resistance", "100%", (r) => `${pct(r.metrics.injectionResistance.value)} ${status(r.metrics.injectionResistance)}`],
    ["Cost per case (simulated)", "reported", (r) => `$${(r.metrics.costPerCaseUsd.value ?? 0).toFixed(4)}`],
    ["p50 latency (simulated)", "under 20 s", (r) => `${((r.metrics.p50LatencyMs.value ?? 0) / 1000).toFixed(1)} s ${status(r.metrics.p50LatencyMs)}`],
    ["Mock payload validity", "100%", (r) => `${pct(r.checks.mockPayloadValidity.value)} ${status(r.checks.mockPayloadValidity)}`],
    ["Invalid replies reaching the UI", "exactly 0", (r) => `${r.checks.replyValidity.value} ${status(r.checks.replyValidity)}`],
  ];
  const extra: [string, (r: EvalReport) => string][] = [
    ["Label agreement over extra seeds (mean, min to max)", (r) => (r.sweep ? `${pct(r.sweep.labelAgreement.mean)} (${pct(r.sweep.labelAgreement.min)} to ${pct(r.sweep.labelAgreement.max)})` : "n/a")],
    ["Exact-credit match over extra seeds (mean, min to max)", (r) => (r.sweep ? `${pct(r.sweep.exactCreditMatch.mean)} (${pct(r.sweep.exactCreditMatch.min)} to ${pct(r.sweep.exactCreditMatch.max)})` : "n/a")],
    ["Extra seeds with a hard failure", (r) => (r.sweep ? `${r.sweep.hardFailureSeeds} of ${r.sweep.seeds}` : "n/a")],
    ["Money error: over-credited / under-credited", (r) => `${usd(r.moneyError.overCreditCents)} / ${usd(r.moneyError.underCreditCents)} of ${usd(r.moneyError.expectedTotalCents)} expected`],
    ["Human load: Cases that need a person", (r) => `${r.humanLoad.casesNeedingHuman} of ${r.humanLoad.cases} (${r.humanLoad.expectedCasesNeedingHuman} by design)`],
    ["Checkpoints sent to a person that the rubric settles", (r) => `${r.humanLoad.checkpointsToHuman} of ${r.humanLoad.checkpoints}`],
    ["Correct model Labels citing every required field", (r) => (r.checks.citationCompleteness ? r.checks.citationCompleteness.detail.replace(" correct model Labels cite every required field", "") : "n/a")],
    ["Reply validator on a labeled set: true positive / true negative", (r) => `${pct(r.validator.truePositiveRate, 0)} of ${r.validator.bad} bad / ${pct(r.validator.trueNegativeRate, 0)} of ${r.validator.good} good`],
  ];
  const lines = [
    `**Every figure below is simulated, not a real-model measurement.** It shows how well the guardrails contain the mistakes of two Simulated models with declared error profiles. Cost uses an illustrative price table; latency is recorded from a declared distribution.`,
    "",
    `| Metric | Target | ${head.join(" | ")} |`,
    `| --- | --- | ${have.map(() => "---").join(" | ")} |`,
    ...rows.map(([m, t, f]) => `| ${m} | ${t} | ${[a, b].filter(Boolean).map((r) => cell(r, f)).join(" | ")} |`),
    ...extra.map(([m, f]) => `| ${m} | | ${[a, b].filter(Boolean).map((r) => cell(r, f)).join(" | ")} |`),
  ];
  const rerun = (b ?? a)?.checks.modelRerun;
  if (rerun) lines.push("", `Second-model rerun: label agreement of the two models differs by ${rerun.gapPoints} points (limit ${rerun.maxGapPoints}); ${rerun.pass ? "met" : "**missed**"}.`);
  return lines.join("\n");
}
