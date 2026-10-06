import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import type { DecisionRecord, LabelRecord, Override, TraceStep } from "./types";
import type { CreditLine } from "@/lib/policy/engine";

type Row = typeof schema.decisions.$inferSelect;

export function rowToRecord(r: Row): DecisionRecord {
  return {
    id: r.id, ticketId: r.ticketId, sessionId: r.sessionId,
    labels: r.labels as LabelRecord[], clauses: r.clauses, lines: r.lines as CreditLine[],
    amountCents: r.amountCents, subtotalCents: r.subtotalCents, capStatus: r.capStatus as DecisionRecord["capStatus"],
    status: r.status as DecisionRecord["status"], needsHuman: r.needsHuman, needsLead: r.needsLead,
    routeTo: r.routeTo as DecisionRecord["routeTo"], fileLinear: r.fileLinear, approver: r.approver,
    overrideReason: r.overrideReason, overrides: r.overrides as Override[], policyVersion: r.policyVersion,
    modelName: r.modelName, promptVersion: r.promptVersion, injectionDetected: r.injectionDetected,
    complaint: r.complaint, reply: r.reply, notes: r.notes, unresolved: r.unresolved, priorCredit: r.priorCredit ?? null,
    trace: r.trace as TraceStep[], costUsd: r.costUsd, latencyMs: r.latencyMs, ceilingCents: r.ceilingCents,
    headroomCents: r.headroomCents, createdAt: r.createdAt, approvedAt: r.approvedAt,
  };
}

export function loadDecision(db: Db, ticketId: string): DecisionRecord | null {
  const r = db.select().from(schema.decisions).where(eq(schema.decisions.ticketId, ticketId)).get();
  return r ? rowToRecord(r) : null;
}

export function saveDecision(db: Db, d: DecisionRecord): void {
  const values = {
    id: d.id, ticketId: d.ticketId, sessionId: d.sessionId, labels: d.labels, clauses: d.clauses, lines: d.lines,
    amountCents: d.amountCents, subtotalCents: d.subtotalCents, capStatus: d.capStatus, status: d.status,
    needsHuman: d.needsHuman, needsLead: d.needsLead, routeTo: d.routeTo, fileLinear: d.fileLinear,
    approver: d.approver, overrideReason: d.overrideReason, overrides: d.overrides, policyVersion: d.policyVersion,
    modelName: d.modelName, promptVersion: d.promptVersion, injectionDetected: d.injectionDetected,
    complaint: d.complaint, reply: d.reply, notes: d.notes, unresolved: d.unresolved, priorCredit: d.priorCredit,
    trace: d.trace, costUsd: d.costUsd, latencyMs: d.latencyMs, ceilingCents: d.ceilingCents,
    headroomCents: d.headroomCents, createdAt: d.createdAt, approvedAt: d.approvedAt,
  };
  db.insert(schema.decisions).values(values).onConflictDoUpdate({ target: schema.decisions.ticketId, set: values }).run();
}
