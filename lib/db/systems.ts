import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { schema } from "./client";

export type OutboxRow = typeof schema.outbox.$inferSelect;

/** Newest first. Ties (the demo clock is frozen) fall back to insertion order. */
export function listOutbox(db: Db, system: "orb" | "zendesk" | "linear"): OutboxRow[] {
  return db.select().from(schema.outbox).where(eq(schema.outbox.system, system)).orderBy(desc(schema.outbox.createdAt), desc(sql`rowid`)).all();
}
