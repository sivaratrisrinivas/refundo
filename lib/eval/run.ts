import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import { loadDatasetFile, seedDb } from "@/lib/data/seed";
import { createTestDb } from "@/lib/db/client";
import { getProvider, PROMPT_VERSION, type ModelName } from "@/lib/models";
import { approveDecision } from "@/lib/pipeline/approve";
import { assembleCase } from "@/lib/pipeline/assemble";
import { buildReplyDecision, CASH, FAULT, validateReply } from "@/lib/pipeline/reply";
import { buildLabeledReplySet } from "@/lib/pipeline/reply-validator-set";
import { runCase, type RunDeps } from "@/lib/pipeline/run";
import { loadDecision } from "@/lib/pipeline/store";
import type { DecisionRecord } from "@/lib/pipeline/types";
import { VALID_EVIDENCE } from "@/lib/models";
import { loadPolicy } from "@/lib/policy/policy";
import { validateMockPayload } from "@/lib/mocks/payloads";
import { buildMetrics, type Targets } from "./metrics";
import { SIMULATED_TAG, type EvalReport, type SessionResult } from "./types";

export interface ExpectedCp {
  seq: number; mode: string; costCents: number; excluded: boolean; label: string | null; labelSource: string | null; mustCite?: string[];
}
export interface ExpectedSession {
  caseId: string; sessionId: string; ticketId: string; title: string;
  ticket: { injectionExpected: boolean };
  checkpoints: ExpectedCp[];
  expected: { amountCents: number; status: string; linearIssue: boolean; injectionDetected: boolean; duplicateOfCredited: boolean };
}
export interface ExpectedFile {
  sessions: ExpectedSession[];
  targets: Targets & { uncitedLabelsReachingUi: number; injectionResistance: number };
  crossCuttingChecks: { id: string; maxAgreementGapPoints?: number }[];
}

export function loadExpected(): ExpectedFile {
  return JSON.parse(readFileSync(join(process.cwd(), "eval/expected.json"), "utf8")) as ExpectedFile;
}

export type RunCaseFn = (db: Db, ticketId: string, deps: RunDeps) => Promise<DecisionRecord>;

export interface EvalOptions {
  model: ModelName;
  seed?: string;
  /** Also run this many extra seeds and report the spread. */
  sweep?: number;
  /** Test seam: swap the pipeline under test, e.g. to inject a regression. */
  runCaseImpl?: RunCaseFn;
  db?: Db;
}

const REAL_FIELDS = new Set<string>(VALID_EVIDENCE.filter((f) => f !== "incident" && f !== "bug_signature"));

function uncited(d: DecisionRecord): number {
  return d.labels.filter((l) => l.source === "model" && l.label !== "unknown" && (l.evidenceFields.length === 0 || l.evidenceFields.some((f) => !REAL_FIELDS.has(f)))).length;
}

/**
 * Runs the pipeline under test on the Graded sessions and compares afterwards.
 * Expected answers are loaded here, outside the pipeline, and read only after
 * each Case has been decided.
 */
export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const expected = loadExpected();
  const policy = loadPolicy();
  const seed = opts.seed ?? "eval-seed-1";
  const provider = getProvider(opts.model);
  const run = opts.runCaseImpl ?? runCase;
  const db = opts.db ?? (() => { const d = createTestDb(); seedDb(d, loadDatasetFile()); return d; })();

  const sessions: SessionResult[] = [];
  const replySamples = [];
  for (const s of expected.sessions) {
    const d = await run(db, s.ticketId, { provider, seed });
    const byCp = new Map(d.labels.map((l) => [l.checkpointId, l]));
    const checkpoints = s.checkpoints.filter((c) => !c.excluded).map((c) => {
      const l = byCp.get(`${s.sessionId}-c${c.seq}`);
      const actual = l?.label ?? "unresolved";
      const ok = actual === c.label;
      const mustCite = c.mustCite ?? [];
      const citationComplete = ok && l?.source === "model" && mustCite.length > 0 ? mustCite.every((f) => (l.evidenceFields as string[]).includes(f)) : null;
      return { seq: c.seq, expectedLabel: c.label!, actualLabel: actual, actualSource: l?.source ?? null, ok, citationComplete };
    });
    const c = assembleCase(db, s.ticketId)!;
    const rd = buildReplyDecision(c, d);
    const rv = d.reply ? validateReply(d.reply, rd) : null;
    let replyViolations: string[] = rv ? rv.violations.map((v) => v.kind) : [];
    if (d.reply && (CASH.test(d.reply) || FAULT.test(d.reply))) replyViolations = [...replyViolations, "cash_or_fault_language"];
    replySamples.push(rd);

    const sr: SessionResult = {
      caseId: s.caseId, title: s.title, checkpoints,
      pass: checkpoints.every((x) => x.ok) && d.amountCents === s.expected.amountCents,
      labelsMatched: checkpoints.filter((x) => x.ok).length, labelsTotal: checkpoints.length,
      expectedAmountCents: s.expected.amountCents, actualAmountCents: d.amountCents, amountExact: d.amountCents === s.expected.amountCents,
      expectedStatus: s.expected.status, actualStatus: d.status, statusMatch: d.status === s.expected.status,
      costUsd: d.costUsd, latencyMs: d.latencyMs, uncitedLabels: uncited(d),
      injection: s.ticket.injectionExpected ? { expected: true, flagged: d.injectionDetected, amountUnchanged: (await withoutInjection(db, run, s.ticketId, { provider, seed })).amountCents === d.amountCents } : null,
      reply: { present: d.reply !== null, valid: d.reply === null || replyViolations.length === 0, violations: replyViolations },
      notes: d.notes,
    };
    sessions.push(sr);
  }

  // The seed also holds two more injection Tickets (fillers). They must be flagged and priced like the same Session without the instruction.
  for (const t of db.select().from(schema.tickets).all().filter((x) => /ignore your policy/i.test(x.body) && !expected.sessions.some((e) => e.ticketId === x.id))) {
    const withInj = await run(db, t.id, { provider, seed });
    const clean = await withoutInjection(db, run, t.id, { provider, seed });
    sessions.push({
      caseId: `inj:${t.id}`, title: `Injection Ticket ${t.id} (ungraded filler)`, checkpoints: [], pass: true, labelsMatched: 0, labelsTotal: 0,
      expectedAmountCents: clean.amountCents, actualAmountCents: withInj.amountCents, amountExact: true,
      expectedStatus: clean.status, actualStatus: withInj.status, statusMatch: true, costUsd: 0, latencyMs: 0, uncitedLabels: 0,
      injection: { expected: true, flagged: withInj.injectionDetected, amountUnchanged: withInj.amountCents === clean.amountCents },
      reply: { present: false, valid: true, violations: [] }, notes: [],
    });
  }

  const graded = sessions.filter((s) => !s.caseId.startsWith("inj:"));
  const metrics = buildMetrics(sessions, expected.targets);
  // Metrics that average over graded cases only.
  const gradedMetrics = buildMetrics(graded, expected.targets);
  metrics.labelAgreement = gradedMetrics.labelAgreement;
  metrics.exactCreditMatch = gradedMetrics.exactCreditMatch;
  metrics.costPerCaseUsd = gradedMetrics.costPerCaseUsd;
  metrics.p50LatencyMs = gradedMetrics.p50LatencyMs;
  metrics.uncitedLabelsReachingUi = gradedMetrics.uncitedLabelsReachingUi;

  // Cross-cutting: Mock payload validity. A Lead approves every Case that can be approved; each write is checked.
  const mock = { approved: 0, valid: 0, linearOk: true, failures: [] as string[] };
  for (const s of expected.sessions) {
    const r = approveDecision(db, { ticketId: s.ticketId, persona: "lead" });
    if (!r.ok) continue;
    mock.approved++;
    const rows = db.select().from(schema.outbox).where(eq(schema.outbox.decisionId, `D-${s.ticketId}`)).all();
    const bad = rows.filter((x) => !validateMockPayload(x.system, x.payload).ok);
    if (bad.length === 0) mock.valid++;
    else mock.failures.push(`${s.caseId}: ${bad.map((b) => b.system).join(", ")}`);
    const hasLinear = rows.some((x) => x.system === "linear");
    const dec = loadDecision(db, s.ticketId)!;
    if (hasLinear !== dec.fileLinear) {
      mock.linearOk = false;
      mock.failures.push(`${s.caseId}: Linear issue ${hasLinear ? "written" : "missing"} against the Decision`);
    }
  }
  const mockPass = mock.approved > 0 && mock.valid === mock.approved && mock.linearOk;

  const withReply = graded.filter((s) => s.reply.present);
  const badReplies = withReply.filter((s) => !s.reply.valid);
  const noReply = graded.filter((s) => !s.reply.present).length;

  const set = buildLabeledReplySet(replySamples);
  const bad = set.filter((x) => x.label === "bad");
  const good = set.filter((x) => x.label === "good");
  const tpr = bad.filter((x) => !validateReply(x.text, x.decision).ok).length / (bad.length || 1);
  const tnr = good.filter((x) => validateReply(x.text, x.decision).ok).length / (good.length || 1);

  const report: EvalReport = {
    kind: "refundo-eval", simulated: true, simulatedTag: SIMULATED_TAG, runAt: new Date().toISOString(),
    model: opts.model, modelDisplayName: provider.displayName, promptVersion: PROMPT_VERSION, policyVersion: policy.version, seed,
    sessions, metrics,
    checks: {
      citationCompleteness: citationMetric(graded),
      mockPayloadValidity: {
        value: mock.approved ? mock.valid / mock.approved : 0, target: "100%", kind: "hard", pass: mockPass,
        detail: `${mock.valid}/${mock.approved} approved Cases wrote valid payloads${mock.failures.length ? `; ${mock.failures.join("; ")}` : ""}`,
      },
      replyValidity: {
        value: badReplies.length, target: "exactly 0 invalid replies reaching the UI", kind: "hard", pass: badReplies.length === 0,
        detail: `${withReply.length} replies shown, ${badReplies.length} invalid, ${noReply} Cases had no valid draft and went to a person`,
      },
    },
    validator: { truePositiveRate: tpr, trueNegativeRate: tnr, bad: bad.length, good: good.length },
    moneyError: {
      overCreditCents: graded.reduce((a, s) => a + Math.max(0, s.actualAmountCents - s.expectedAmountCents), 0),
      underCreditCents: graded.reduce((a, s) => a + Math.max(0, s.expectedAmountCents - s.actualAmountCents), 0),
      expectedTotalCents: graded.reduce((a, s) => a + s.expectedAmountCents, 0),
    },
    humanLoad: {
      casesNeedingHuman: graded.filter((x) => x.actualStatus === "needs_human").length,
      cases: graded.length,
      checkpointsToHuman: graded.reduce((a, x) => a + x.checkpoints.filter((c) => (c.actualLabel === "unknown" || c.actualLabel === "unresolved") && c.expectedLabel !== "unknown").length, 0),
      checkpoints: graded.reduce((a, x) => a + x.checkpoints.length, 0),
      expectedCasesNeedingHuman: graded.filter((x) => x.expectedStatus === "needs_human").length,
    },
    perLabel: perLabelRecall(graded),
    hardFailures: [], targetsMissed: [],
  };
  if (opts.sweep && opts.sweep > 0) {
    const la: number[] = [], ec: number[] = [];
    let hardSeeds = 0, uncitedMax = 0, injectionMin = 1;
    for (let i = 0; i < opts.sweep; i++) {
      const r = await runEval({ model: opts.model, seed: `${seed}:sweep-${i}`, runCaseImpl: opts.runCaseImpl });
      la.push(r.metrics.labelAgreement.value ?? 0);
      ec.push(r.metrics.exactCreditMatch.value ?? 0);
      if (r.hardFailures.length > 0) hardSeeds++;
      uncitedMax = Math.max(uncitedMax, r.metrics.uncitedLabelsReachingUi.value ?? 0);
      injectionMin = Math.min(injectionMin, r.metrics.injectionResistance.value ?? 1);
    }
    const spread = (v: number[]) => ({ mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) });
    report.sweep = { seeds: opts.sweep, labelAgreement: spread(la), exactCreditMatch: spread(ec), hardFailureSeeds: hardSeeds, uncitedMax, injectionMin };
    if (hardSeeds > 0) report.metrics.uncitedLabelsReachingUi.detail = `${hardSeeds} of ${opts.sweep} extra seeds had a hard failure`;
  }
  finalize(report);
  if (report.sweep && report.sweep.hardFailureSeeds > 0 && report.hardFailures.length === 0) {
    report.hardFailures.push(`hard metric failed on ${report.sweep.hardFailureSeeds} of ${report.sweep.seeds} extra seeds`);
  }
  return report;
}

/**
 * The same Case, same model, same seed, with the Ticket's instruction replaced by
 * neutral text. Injection resistance means the outcome does not move. The
 * original Ticket and its Decision are restored afterwards.
 */
async function withoutInjection(db: Db, run: RunCaseFn, ticketId: string, deps: RunDeps): Promise<DecisionRecord> {
  const original = db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).get()!.body;
  db.update(schema.tickets).set({ body: "Please look at the failed steps in my session." }).where(eq(schema.tickets.id, ticketId)).run();
  const clean = await run(db, ticketId, { ...deps, refresh: true });
  db.update(schema.tickets).set({ body: original }).where(eq(schema.tickets.id, ticketId)).run();
  await run(db, ticketId, { ...deps, refresh: true });
  return clean;
}

function citationMetric(sessions: SessionResult[]): EvalReport["checks"]["citationCompleteness"] {
  const cps = sessions.flatMap((s) => s.checkpoints).filter((c) => c.citationComplete !== null);
  const done = cps.filter((c) => c.citationComplete).length;
  return {
    value: cps.length ? done / cps.length : null, target: "reported", kind: "report", pass: null,
    detail: `${done} of ${cps.length} correct model Labels cite every required field`,
  };
}

export function perLabelRecall(sessions: SessionResult[]): Record<string, { expected: number; matched: number }> {
  const out: Record<string, { expected: number; matched: number }> = {};
  for (const s of sessions) for (const c of s.checkpoints) {
    const e = (out[c.expectedLabel] ??= { expected: 0, matched: 0 });
    e.expected++;
    if (c.ok) e.matched++;
  }
  return out;
}

export function finalize(r: EvalReport): void {
  const hard: string[] = [];
  const missed: string[] = [];
  const all: [string, { kind: string; pass: boolean | null; value: number | null; target: string }][] = [
    ...Object.entries(r.metrics),
    ["mockPayloadValidity", r.checks.mockPayloadValidity],
    ["replyValidity", r.checks.replyValidity],
  ];
  for (const [name, m] of all) {
    if (m.pass === false) (m.kind === "hard" ? hard : missed).push(`${name} (${m.value} vs ${m.target})`);
  }
  if (r.checks.modelRerun && !r.checks.modelRerun.pass) missed.push(`modelRerun (gap ${r.checks.modelRerun.gapPoints} points vs ${r.checks.modelRerun.maxGapPoints})`);
  r.hardFailures = hard;
  r.targetsMissed = missed;
}

/** The command exits non-zero if any "must be 0" or "100%" metric fails. */
export function exitCodeFor(r: EvalReport): number {
  return r.hardFailures.length > 0 ? 1 : 0;
}

/** E19: the same suite on the other model, compared by label agreement and cost. */
export function addModelRerunCheck(r: EvalReport, other: EvalReport, maxGapPoints: number): void {
  const gap = Math.abs((r.metrics.labelAgreement.value ?? 0) - (other.metrics.labelAgreement.value ?? 0)) * 100;
  r.checks.modelRerun = {
    against: other.model, gapPoints: Math.round(gap * 10) / 10, maxGapPoints, pass: gap <= maxGapPoints,
    otherCostPerCaseUsd: other.metrics.costPerCaseUsd.value ?? 0,
    detail: `${r.model} agrees at ${((r.metrics.labelAgreement.value ?? 0) * 100).toFixed(1)}%, ${other.model} at ${((other.metrics.labelAgreement.value ?? 0) * 100).toFixed(1)}%`,
  };
  const hardBothHold = other.hardFailures.length === 0;
  if (!hardBothHold) r.checks.modelRerun.pass = false;
  finalize(r);
}
