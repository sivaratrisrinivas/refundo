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
import { detectInjection, asTicketData } from "./injection";
import { complaintSchema } from "@/lib/models/schemas";
import { callValidated, labelSchema, normalizeClaims, toLabelInput, toVerifyInput, validateModelLabel, verifySchema } from "./model-steps";
import { buildReplyDecision, draftReply, validateReply } from "./reply";
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
    overrideReason: [...overrides].reverse().find((o) => o.kind !== "reply")?.reason ?? null, overrides, createdAt: nowIso(), priorCredit: c.priorCredit,
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

  // Stage 2: complaint extraction. Ticket text is delimited data; it never reaches pricing.
  const decisionNotes: string[] = [];
  let forcedHuman = false;
  let complaint: unknown = null;
  let modelInjection = false;
  let modelDispute = false;
  if (deps.provider) {
    const seed = `${deps.seed ?? "refundo-seed-1"}:${ticketId}`;
    const r = await callValidated(deps.provider, "complaint", { ticketText: asTicketData(c.ticket.body) }, { seed }, complaintSchema, "extract complaint");
    trace.push(r.trace);
    if (r.value) {
      complaint = r.value;
      modelInjection = r.value.injectionDetected;
      modelDispute = r.value.disputeThreat;
    } else {
      forcedHuman = true;
      decisionNotes.push("The complaint extractor returned malformed output twice; a person should read the Ticket.");
    }
  }
  const injectionDetected = modelInjection || detectInjection(c.ticket.body);
  if (injectionDetected) {
    decisionNotes.push("The Ticket contains an instruction aimed at the pricing system. It was ignored: Credit comes only from Labels and policy.");
  }
  if (modelDispute && !c.ticket.disputeThreatened) {
    decisionNotes.push("The Ticket text mentions a dispute but the intake flag is off, so no Chargeback bump was applied. A Lead may confirm.");
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
  // Stages 4-5: claim verifier and Labeler, for Checkpoints no rule or person settled.
  const needModel = pending.filter((id) => !labelByCp.has(id));
  if (deps.provider && needModel.length > 0) {
    const cps = c.checkpoints.filter((k) => needModel.includes(k.id));
    const seed = `${deps.seed ?? "refundo-seed-1"}:${ticketId}`;
    const v = await callValidated(deps.provider, "verify", toVerifyInput(cps), { seed }, verifySchema, "verify claims");
    trace.push(v.trace);
    if (!v.value) {
      forcedHuman = true;
      decisionNotes.push("The claim verifier returned malformed output twice; a person must label these Checkpoints.");
    } else {
      const claims = normalizeClaims(v.value);
      const flags = new Map(signals.map((s) => [s.checkpointId, s.flags]));
      const l = await callValidated(deps.provider, "label", toLabelInput(cps, flags, claims), { seed }, labelSchema, "label");
      trace.push(l.trace);
      if (!l.value) {
        forcedHuman = true;
        decisionNotes.push("The Labeler returned malformed output twice; a person must label these Checkpoints.");
      } else {
        for (const raw of l.value) {
          if (!needModel.includes(raw.checkpointId) || labelByCp.has(raw.checkpointId)) continue;
          const cl = claims.get(raw.checkpointId);
          const cp = c.checkpoints.find((k) => k.id === raw.checkpointId);
          labelByCp.set(raw.checkpointId, { ...validateModelLabel(raw, cl, policy.minConfidence, cp ? { appTestPassed: cp.appTest.passed } : undefined), claims: cl });
        }
      }
    }
  }
  const unresolved = pending.filter((id) => !labelByCp.has(id));

  const finalLabels: LabelRecord[] = [];
  for (const cp of c.checkpoints) {
    const l = labelByCp.get(cp.id);
    if (!l) continue;
    finalLabels.push({
      ...l,
      note: l.note ?? notes.get(cp.id),
      ...(l.label === "unknown" && l.source !== "human" ? { humanPrompt: l.humanPrompt ?? HUMAN_PROMPT } : {}),
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
  let status: DecisionRecord["status"] = priced.status;
  let amountCents = priced.amountCents;
  let lines = priced.lines;
  let needsLead = priced.needsLead;
  let needsHuman = priced.needsHuman || forcedHuman;
  if (forcedHuman && status !== "recommend_only") status = "needs_human";
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

  const d0: DecisionRecord = {
    ...base,
    labels: finalLabels, clauses: priced.clauses, lines, amountCents, subtotalCents: priced.subtotalCents,
    capStatus: priced.capStatus, status, needsHuman, needsLead, routeTo: priced.routeTo, fileLinear: priced.fileLinear,
    injectionDetected, complaint, reply: null, notes: decisionNotes, unresolved, trace,
    costUsd: trace.reduce((s, t) => s + (t.costUsd ?? 0), 0), latencyMs: trace.reduce((s, t) => s + (t.latencyMs ?? 0), 0),
    ceilingCents: priced.ceilingCents, headroomCents: priced.headroomCents,
  };
  // Stage 8: draft the reply. A specialist's edit is kept while it still validates.
  const rd = buildReplyDecision(c, d0);
  let reply: string | null = null;
  const edit = [...overrides].reverse().find((o) => o.kind === "reply");
  if (edit && validateReply(String(edit.to), rd).ok) reply = String(edit.to);
  else if (deps.provider) {
    const out = await draftReply(deps.provider, rd, `${deps.seed ?? "refundo-seed-1"}:${ticketId}`);
    trace.push(out.trace);
    reply = out.reply;
    if (!out.reply) {
      d0.needsHuman = true;
      if (d0.status !== "recommend_only") d0.status = "needs_human";
      d0.notes.push("No reply draft passed validation, so a person must write the reply.");
    }
  }
  const d: DecisionRecord = {
    ...d0, reply, trace,
    costUsd: trace.reduce((s, t) => s + (t.costUsd ?? 0), 0), latencyMs: trace.reduce((s, t) => s + (t.latencyMs ?? 0), 0),
  };
  saveDecision(db, d);
  db.update(schema.tickets).set({ status: needsLead ? "needs_lead" : "decided" }).where(eq(schema.tickets.id, ticketId)).run();
  return d;
}
