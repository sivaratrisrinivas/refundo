import { eq } from "drizzle-orm";
import { nowIso } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import { PROMPT_VERSION, type ModelProvider } from "@/lib/models";
import { price, type PriceResult } from "@/lib/policy/engine";
import { loadPolicy } from "@/lib/policy/policy";
import type { CheckpointLabel } from "@/lib/policy/types";
import { assembleCase } from "./assemble";
import { applyAmountOverride, latestAmountOverride, overrideLabels } from "./overrides";
import { runSignals } from "./signals";
import { loadDecision, saveDecision } from "./store";
import type { DecisionRecord, LabelRecord, TraceStep } from "./types";

export interface RunDeps {
  /** The only injected dependency of the case seam: which Simulated model to use. */
  provider?: ModelProvider;
  seed?: string;
}

const HUMAN_PROMPT = "No rule or model could settle this Checkpoint. Choose a Label and give a reason.";

/**
 * The case seam. Runs the pipeline for one Ticket and stores a Decision. The
 * same Case run twice yields the identical stored Decision (frozen clock, seeded
 * models, deterministic id). An approved Decision is never recomputed.
 */
export async function runCase(db: Db, ticketId: string, deps: RunDeps = {}): Promise<DecisionRecord> {
  const existing = loadDecision(db, ticketId);
  if (existing?.status === "approved") return existing;

  const c = assembleCase(db, ticketId);
  if (!c) throw new Error(`no such Ticket: ${ticketId}`);
  const policy = loadPolicy();
  const trace: TraceStep[] = [{ step: "assemble", ok: c.session !== null, note: c.session ? `${c.checkpoints.length} Checkpoints` : "no Session" }];
  const overrides = existing?.overrides ?? [];
  const base = {
    id: `D-${ticketId}`, ticketId, sessionId: c.session?.id ?? null, policyVersion: policy.version,
    modelName: deps.provider?.name ?? "rules-only", promptVersion: PROMPT_VERSION, approver: null, approvedAt: null,
    overrideReason: null, overrides, createdAt: nowIso(), priorCredit: c.priorCredit,
  };

  // A missing Session needs a person.
  if (!c.session) {
    const d: DecisionRecord = {
      ...base, labels: [], clauses: [], lines: [], amountCents: 0, subtotalCents: 0, capStatus: "none", status: "needs_human",
      needsHuman: true, needsLead: false, routeTo: null, fileLinear: false, injectionDetected: false, complaint: null,
      reply: null, notes: ["No Session is attached to this Ticket, so there is nothing to price."], unresolved: [],
      trace, costUsd: 0, latencyMs: 0, ceilingCents: null, headroomCents: null,
    };
    saveDecision(db, d);
    db.update(schema.tickets).set({ status: "decided" }).where(eq(schema.tickets.id, ticketId)).run();
    return d;
  }

  // Stage 3: deterministic signals.
  const signals = runSignals(c.checkpoints, c.incidents, c.bugSignatures, policy);
  trace.push({ step: "signals", ok: true, note: `${signals.filter((s) => s.label).length} settled by rule` });

  const labelByCp = new Map<string, LabelRecord>();
  const notes = new Map<string, string>();
  for (const s of signals) {
    if (s.note) notes.set(s.checkpointId, s.note);
    if (s.label) labelByCp.set(s.checkpointId, { ...s.label });
  }
  const pending = signals.filter((s) => !s.excluded && !s.label).map((s) => s.checkpointId);

  // Human Overrides beat every rule and model Label.
  const human = overrideLabels(overrides);
  for (const h of human) labelByCp.set(h.checkpointId, { ...h });
  const unresolved = pending.filter((id) => !labelByCp.has(id));

  const finalLabels: LabelRecord[] = [];
  for (const cp of c.checkpoints) {
    const l = labelByCp.get(cp.id);
    if (!l) continue;
    finalLabels.push({
      ...l,
      note: l.note ?? notes.get(cp.id),
      ...(l.label === "unknown" && l.source !== "human" ? { humanPrompt: HUMAN_PROMPT } : {}),
    });
  }

  // Stage 7: price in code. Ticket text is not an input.
  const allLabels: CheckpointLabel[] = finalLabels;
  let priced: PriceResult = price({
    checkpoints: c.checkpoints.map((k) => ({ id: k.id, seq: k.seq, costCents: k.costCents, mode: k.mode })),
    labels: allLabels,
    account: { plan: c.account.plan, creditsGranted30dCents: c.account.creditsGranted30dCents },
    disputeThreatened: c.ticket.disputeThreatened,
    policy,
  });
  const amountOverride = latestAmountOverride(overrides);
  if (amountOverride !== null && priced.ceilingCents !== null && amountOverride <= priced.ceilingCents) {
    priced = applyAmountOverride(priced, amountOverride);
  }
  const decisionNotes: string[] = [];
  let status: DecisionRecord["status"] = priced.status;
  let amountCents = priced.amountCents;
  let lines = priced.lines;
  let needsLead = priced.needsLead;
  let needsHuman = priced.needsHuman;
  if (c.priorCredit) {
    // A second Ticket for an already-credited Session never earns a second Credit.
    amountCents = 0;
    lines = lines.map((l) => ({ ...l, creditCents: 0 }));
    status = "ready";
    needsLead = false;
    needsHuman = false;
    decisionNotes.push(`Session already credited on ${c.priorCredit.approvedOn}; no second Credit is added.`);
  }
  trace.push({ step: "price", ok: true, note: `${priced.status}, ${amountCents} cents` });

  const d: DecisionRecord = {
    ...base,
    labels: finalLabels, clauses: priced.clauses, lines, amountCents, subtotalCents: priced.subtotalCents,
    capStatus: priced.capStatus, status, needsHuman, needsLead, routeTo: priced.routeTo, fileLinear: priced.fileLinear,
    injectionDetected: false, complaint: null, reply: null, notes: decisionNotes, unresolved, trace,
    costUsd: trace.reduce((s, t) => s + (t.costUsd ?? 0), 0), latencyMs: trace.reduce((s, t) => s + (t.latencyMs ?? 0), 0),
    ceilingCents: priced.ceilingCents, headroomCents: priced.headroomCents,
  };
  saveDecision(db, d);
  db.update(schema.tickets).set({ status: needsLead ? "needs_lead" : "decided" }).where(eq(schema.tickets.id, ticketId)).run();
  return d;
}
