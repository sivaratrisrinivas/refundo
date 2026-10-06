import { eq } from "drizzle-orm";
import { ageHours } from "@/lib/clock";
import type { Db } from "./client";
import { schema } from "./client";

export type Risk = "high" | "watch" | "normal";
export type TicketStatus = "open" | "decided" | "approved" | "needs_lead";
export const STATUSES: TicketStatus[] = ["open", "decided", "needs_lead", "approved"];

export interface QueueRow {
  ticketId: string;
  subject: string;
  customer: string;
  plan: "core" | "pro" | "enterprise";
  disputedCents: number;
  ageHours: number;
  status: TicketStatus;
  disputeThreatened: boolean;
  risk: Risk;
}

const RISK_RANK: Record<Risk, number> = { high: 0, watch: 1, normal: 2 };

/**
 * Chargeback risk first (a threatened dispute), then Tickets from accounts with
 * dispute history, then everything else; oldest first within a tier. Reads
 * only columns a specialist may see: never the Session's Failure pattern.
 */
export function listQueue(db: Db, filter: { status?: TicketStatus } = {}): QueueRow[] {
  const rows = db
    .select({
      ticketId: schema.tickets.id,
      subject: schema.tickets.subject,
      customer: schema.accounts.name,
      plan: schema.accounts.plan,
      priorDisputes: schema.accounts.priorDisputes,
      disputedCents: schema.sessions.totalCostCents,
      createdAt: schema.tickets.createdAt,
      status: schema.tickets.status,
      disputeThreatened: schema.tickets.disputeThreatened,
    })
    .from(schema.tickets)
    .innerJoin(schema.accounts, eq(schema.tickets.accountId, schema.accounts.id))
    .leftJoin(schema.sessions, eq(schema.tickets.sessionId, schema.sessions.id))
    .all();

  return rows
    .filter((r) => !filter.status || r.status === filter.status)
    .map((r): QueueRow => ({
      ticketId: r.ticketId,
      subject: r.subject,
      customer: r.customer,
      plan: r.plan,
      disputedCents: r.disputedCents ?? 0,
      ageHours: ageHours(r.createdAt),
      status: r.status,
      disputeThreatened: r.disputeThreatened,
      risk: r.disputeThreatened ? "high" : r.priorDisputes > 0 ? "watch" : "normal",
    }))
    .sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || b.ageHours - a.ageHours || a.ticketId.localeCompare(b.ticketId));
}
