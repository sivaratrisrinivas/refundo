import { createHash } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import { nowIso } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";

/**
 * The audit log is append-only (SQL triggers refuse UPDATE and DELETE) and
 * hash-chained: each row's hash covers the previous row's hash, so editing any
 * row breaks every hash after it.
 */
export const GENESIS = "GENESIS";

type Tx = Pick<Db, "select" | "insert">;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const hashPayload = (payload: unknown) => sha(canonical(payload));
const rowHash = (prev: string, ts: string, actor: string, action: string, payloadHash: string) =>
  sha([prev, ts, actor, action, payloadHash].join("|"));

export function appendAudit(db: Tx, entry: { actor: string; action: string; payload: unknown }): void {
  const last = db.select({ hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(1).get();
  const prevHash = last?.hash ?? GENESIS;
  const ts = nowIso();
  const payloadHash = hashPayload(entry.payload);
  db.insert(schema.auditLog).values({
    ts, actor: entry.actor, action: entry.action, payload: entry.payload, payloadHash, prevHash,
    hash: rowHash(prevHash, ts, entry.actor, entry.action, payloadHash),
  }).run();
}

export interface ChainCheck { ok: boolean; brokenAtId?: number; reason?: string; rows: number }

/** Recompute every hash and link. Any edited, removed or reordered row is detected. */
export function verifyAuditChain(db: Pick<Db, "select">): ChainCheck {
  const rows = db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.id)).all();
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, brokenAtId: r.id, reason: "broken link to the previous row", rows: rows.length };
    if (hashPayload(r.payload) !== r.payloadHash) return { ok: false, brokenAtId: r.id, reason: "payload does not match its hash", rows: rows.length };
    if (rowHash(r.prevHash, r.ts, r.actor, r.action, r.payloadHash) !== r.hash) return { ok: false, brokenAtId: r.id, reason: "row hash mismatch", rows: rows.length };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length };
}
