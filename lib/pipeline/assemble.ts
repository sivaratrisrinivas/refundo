import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import type { Checkpoint } from "@/lib/policy/types";
import type { CaseData } from "./types";

/**
 * Stage 1: assemble the Case. Reads explicit columns only, so the Session's
 * Failure pattern (stored for the generator and eval) cannot reach the pipeline.
 */
export function assembleCase(db: Db, ticketId: string): CaseData | null {
  const t = db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).get();
  if (!t) return null;
  const a = db.select().from(schema.accounts).where(eq(schema.accounts.id, t.accountId)).get();
  if (!a) return null;

  const session = t.sessionId
    ? db
        .select({
          id: schema.sessions.id,
          startedAt: schema.sessions.startedAt,
          totalCostCents: schema.sessions.totalCostCents,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, t.sessionId))
        .get() ?? null
    : null;

  const checkpoints: Checkpoint[] = session
    ? db
        .select()
        .from(schema.checkpoints)
        .where(eq(schema.checkpoints.sessionId, session.id))
        .orderBy(asc(schema.checkpoints.seq))
        .all()
        .map((c) => ({ ...c, filesChanged: c.filesChanged, appTest: c.appTest }))
    : [];

  const prior = session
    ? db
        .select({ amountCents: schema.decisions.amountCents, approvedAt: schema.decisions.approvedAt })
        .from(schema.decisions)
        .where(
          and(
            eq(schema.decisions.sessionId, session.id),
            eq(schema.decisions.status, "approved"),
            ne(schema.decisions.ticketId, ticketId),
          ),
        )
        .get()
    : undefined;

  return {
    ticket: {
      id: t.id, accountId: t.accountId, sessionId: t.sessionId, subject: t.subject, body: t.body, tags: t.tags,
      piId: t.piId, disputeThreatened: t.disputeThreatened, createdAt: t.createdAt, status: t.status,
    },
    account: {
      id: a.id, name: a.name, plan: a.plan, tenureDays: a.tenureDays,
      creditsGranted30dCents: a.creditsGranted30dCents, priorDisputes: a.priorDisputes, orbCustomerId: a.orbCustomerId,
    },
    session,
    checkpoints,
    incidents: db.select().from(schema.incidents).all().map((i) => ({
      id: i.id, title: i.title, startsAt: i.startsAt, endsAt: i.endsAt, sourceUrl: i.sourceUrl,
    })),
    bugSignatures: db.select().from(schema.bugSignatures).all().map((b) => ({
      id: b.id, name: b.name, pattern: b.pattern, linearIssueRef: b.linearIssueRef,
    })),
    priorCredit: prior
      ? { amountCents: prior.amountCents, approvedOn: (prior.approvedAt ?? "").slice(0, 10) }
      : null,
  };
}
