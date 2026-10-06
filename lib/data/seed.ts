import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { policyVersionForSeed } from "./seed-meta";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import type { Dataset } from "./types";

export function loadDatasetFile(): Dataset {
  return JSON.parse(readFileSync(join(process.cwd(), "data/seed/dataset.json"), "utf8")) as Dataset;
}

const TABLES = [
  "audit_log", "outbox", "decisions", "eval_runs", "tickets", "checkpoints", "sessions", "accounts", "incidents", "bug_signatures",
];

/** Remove every row (used by seed and by demo reset). */
export function clearAll(db: Db): void {
  for (const t of TABLES) db.run(sql.raw(`delete from ${t}`));
  db.run(sql.raw("delete from sqlite_sequence where name = 'audit_log'"));
}

export function seedDb(db: Db, data: Dataset = loadDatasetFile()): void {
  db.transaction((tx) => {
    for (const a of data.accounts) {
      tx.insert(schema.accounts).values({
        id: a.id, name: a.name, plan: a.plan, tenureDays: a.tenureDays,
        creditsGranted30dCents: a.creditsGranted30dCents, priorDisputes: a.priorDisputes, orbCustomerId: a.orbCustomerId,
      }).run();
    }
    for (const s of data.sessions) {
      tx.insert(schema.sessions).values({
        id: s.id, accountId: s.accountId, startedAt: s.startedAt, totalCostCents: s.totalCostCents,
        failurePattern: s.failurePattern, graded: s.graded,
      }).run();
    }
    for (const c of data.checkpoints) tx.insert(schema.checkpoints).values(c).run();
    for (const t of data.tickets) tx.insert(schema.tickets).values(t).run();
    for (const i of data.incidents) tx.insert(schema.incidents).values(i).run();
    for (const b of data.bugSignatures) tx.insert(schema.bugSignatures).values(b).run();
    for (const d of data.priorDecisions) {
      tx.insert(schema.decisions).values({
        id: d.id, ticketId: d.ticketId, sessionId: d.sessionId, labels: [], clauses: ["C2"], lines: [],
        amountCents: d.amountCents, capStatus: "within_cap", status: "approved", approver: d.approver,
        policyVersion: policyVersionForSeed, modelName: "seed", promptVersion: "seed", notes: ["Seeded earlier approval."],
        createdAt: `${d.approvedOn}T10:00:00.000Z`, approvedAt: `${d.approvedOn}T10:05:00.000Z`,
      }).run();
    }
  });
}

/** Seed-on-boot: an empty database is filled once, so a fresh deploy always has a demo. */
export function ensureSeeded(db: Db): void {
  const n = db.select({ n: sql<number>`count(*)` }).from(schema.accounts).get()?.n ?? 0;
  if (n === 0) seedDb(db);
}
