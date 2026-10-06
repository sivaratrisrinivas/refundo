import type { ModelName } from "@/lib/models";
import type { EvalReport, Metric, SessionResult } from "./types";

export interface MetricCell { text: string; status: "met" | "missed" | "hard-fail" | "reported" }
export interface MetricRow { key: string; label: string; target: string; cells: Partial<Record<ModelName, MetricCell>> }

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

function cell(m: Metric, text: string): MetricCell {
  if (m.pass === null) return { text, status: "reported" };
  return { text, status: m.pass ? "met" : m.kind === "hard" ? "hard-fail" : "missed" };
}

/** Headline metrics for each model, formatted. Every value comes straight from a stored report. */
export function metricRows(reports: Partial<Record<ModelName, EvalReport>>): MetricRow[] {
  const defs: { key: string; label: string; pick: (r: EvalReport) => [Metric, string] }[] = [
    { key: "labelAgreement", label: "Label agreement", pick: (r) => [r.metrics.labelAgreement, `${pct(r.metrics.labelAgreement.value)} (${r.metrics.labelAgreement.detail})`] },
    { key: "exactCreditMatch", label: "Exact-credit match", pick: (r) => [r.metrics.exactCreditMatch, `${pct(r.metrics.exactCreditMatch.value)} (${r.metrics.exactCreditMatch.detail})`] },
    { key: "uncited", label: "Uncited Labels reaching the UI", pick: (r) => [r.metrics.uncitedLabelsReachingUi, String(r.metrics.uncitedLabelsReachingUi.value)] },
    { key: "injection", label: "Injection resistance", pick: (r) => [r.metrics.injectionResistance, `${pct(r.metrics.injectionResistance.value)} (${r.metrics.injectionResistance.detail})`] },
    { key: "cost", label: "Cost per case (simulated)", pick: (r) => [r.metrics.costPerCaseUsd, `$${(r.metrics.costPerCaseUsd.value ?? 0).toFixed(4)}`] },
    { key: "latency", label: "p50 latency (simulated)", pick: (r) => [r.metrics.p50LatencyMs, `${((r.metrics.p50LatencyMs.value ?? 0) / 1000).toFixed(1)} s`] },
    { key: "mock", label: "Mock payload validity", pick: (r) => [r.checks.mockPayloadValidity, pct(r.checks.mockPayloadValidity.value)] },
    { key: "reply", label: "Invalid replies reaching the UI", pick: (r) => [r.checks.replyValidity, String(r.checks.replyValidity.value)] },
  ];
  const first = Object.values(reports)[0];
  return defs.map((d) => ({
    key: d.key, label: d.label,
    target: first ? d.pick(first)[0].target : "",
    cells: Object.fromEntries(Object.entries(reports).map(([m, r]) => { const [metric, text] = d.pick(r!); return [m, cell(metric, text)]; })),
  }));
}

export interface SessionRow { caseId: string; title: string; results: Partial<Record<ModelName, SessionResult>> }

export function sessionRows(reports: Partial<Record<ModelName, EvalReport>>): SessionRow[] {
  const base = (reports["sim-a"] ?? reports["sim-b"])?.sessions.filter((s) => !s.caseId.startsWith("inj:")) ?? [];
  return base.map((s) => ({
    caseId: s.caseId, title: s.title,
    results: Object.fromEntries(Object.entries(reports).map(([m, r]) => [m, r!.sessions.find((x) => x.caseId === s.caseId)!])),
  }));
}

export const cents = (c: number) => `$${(c / 100).toFixed(2)}`;
