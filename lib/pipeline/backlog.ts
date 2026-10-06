import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";

export interface BacklogItem {
  ticketId: string; sessionId: string | null; checkpointId: string | null; kind: "label" | "amount";
  from: string | number; to: string | number; reason: string; actor: string; ts: string;
  checkpoint: unknown;
}

/**
 * Overrides, in order, as Graded-session candidates waiting for review: this is how a
 * production version would grow its test set. Derived from the audit log, so it
 * cannot drift from what actually happened.
 */
export function exportOverrideBacklog(db: Db): BacklogItem[] {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "override")).orderBy(asc(schema.auditLog.id)).all().map((r) => {
    const p = r.payload as Record<string, unknown>;
    return {
      ticketId: String(p.ticketId), sessionId: (p.sessionId as string | null) ?? null, checkpointId: (p.checkpointId as string | undefined) ?? null,
      kind: p.kind as "label" | "amount", from: p.from as string | number, to: p.to as string | number, reason: String(p.reason),
      actor: r.actor, ts: r.ts, checkpoint: p.checkpoint ?? null,
    };
  });
}
