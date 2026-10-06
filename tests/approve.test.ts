import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { schema } from "@/lib/db/client";
import { appendAudit, verifyAuditChain } from "@/lib/audit";
import { errorFreeModel } from "@/lib/models";
import { idempotencyKey, validateMockPayload } from "@/lib/mocks/payloads";
import { approveDecision, overrideDecision } from "@/lib/pipeline/approve";
import { runCase } from "@/lib/pipeline/run";
import { loadDecision } from "@/lib/pipeline/store";
import { exportOverrideBacklog } from "@/lib/pipeline/backlog";
import { seededDb } from "./helpers";

const provider = errorFreeModel("sim-a");
const run = (db: ReturnType<typeof seededDb>, t: string) => runCase(db, t, { provider });
// The seed already holds one earlier Credit (E16): two outbox rows and one audit row.
const raw = (db: ReturnType<typeof seededDb>) => ({
  outbox: db.select().from(schema.outbox).all().length,
  audit: db.select().from(schema.auditLog).all().length,
});
const BASE = raw(seededDb());
const counts = (db: ReturnType<typeof seededDb>) => ({ outbox: raw(db).outbox - BASE.outbox, audit: raw(db).audit - BASE.audit });
const mine = (db: ReturnType<typeof seededDb>, ticket: string) => db.select().from(schema.outbox).where(eq(schema.outbox.decisionId, `D-${ticket}`)).all();

describe("approving a priced Case", () => {
  test("writes exactly the Orb and Zendesk outbox rows and one audit row, and updates the account", async () => {
    const db = seededDb();
    await run(db, "T-E2");
    const r = approveDecision(db, { ticketId: "T-E2", persona: "specialist" });
    expect(r.ok).toBe(true);
    const rows = mine(db, "T-E2");
    expect(rows.map((x) => x.system).sort()).toEqual(["orb", "zendesk"]);
    expect(counts(db).audit).toBe(1);
    const d = loadDecision(db, "T-E2")!;
    expect([d.status, d.approver]).toEqual(["approved", "specialist"]);
    expect(db.select().from(schema.tickets).where(eq(schema.tickets.id, "T-E2")).get()!.status).toBe("approved");
    expect(db.select().from(schema.accounts).where(eq(schema.accounts.id, "A-E2")).get()!.creditsGranted30dCents).toBe(1240);

    const orb = rows.find((x) => x.system === "orb")!.payload as { body: { entry_type: string; per_unit_cost_basis: string; amount: number } };
    expect([orb.body.entry_type, orb.body.per_unit_cost_basis, orb.body.amount]).toEqual(["increment", "0", 12.4]);
    const zd = rows.find((x) => x.system === "zendesk")!.payload as { body: { ticket: { tags: string[]; status: string; comment: { public: boolean; body: string } } } };
    expect(zd.body.ticket.tags).toEqual(["credit_issued", "c2"]);
    expect(zd.body.ticket.status).toBe("solved");
    expect(zd.body.ticket.comment.public).toBe(true);
    expect(zd.body.ticket.comment.body).toBe(d.reply!);
  });

  test("a forced failure mid-transaction writes nothing", async () => {
    const db = seededDb();
    await run(db, "T-E2");
    expect(() => approveDecision(db, { ticketId: "T-E2", persona: "specialist" }, { beforeCommit: () => { throw new Error("boom"); } })).toThrow("boom");
    expect(counts(db)).toEqual({ outbox: 0, audit: 0 });
    expect(loadDecision(db, "T-E2")!.status).not.toBe("approved");
    expect(db.select().from(schema.accounts).where(eq(schema.accounts.id, "A-E2")).get()!.creditsGranted30dCents).toBe(0);
    expect(approveDecision(db, { ticketId: "T-E2", persona: "specialist" }).ok).toBe(true);
  });

  test("a second Approval is refused and writes nothing, including after a policy version change", async () => {
    const db = seededDb();
    await run(db, "T-E2");
    approveDecision(db, { ticketId: "T-E2", persona: "specialist" });
    const before = counts(db);
    const again = approveDecision(db, { ticketId: "T-E2", persona: "lead" });
    expect(again).toMatchObject({ ok: false, code: "already_approved" });
    expect(counts(db)).toEqual(before);

    // A new policy version re-opens the Decision; the Session still cannot be credited twice.
    db.update(schema.decisions).set({ status: "decided", policyVersion: "2027-01-draft-2", approvedAt: null, approver: null }).where(eq(schema.decisions.ticketId, "T-E2")).run();
    const third = approveDecision(db, { ticketId: "T-E2", persona: "lead" });
    expect(third).toMatchObject({ ok: false, code: "session_already_credited" });
    expect(counts(db)).toEqual(before);
    expect(idempotencyKey("orb", { sessionId: "S-E2", ticketId: "T-E2" })).toBe(idempotencyKey("orb", { sessionId: "S-E2", ticketId: "T-other" }));
  });

  test("a Reviewer may not approve", async () => {
    const db = seededDb();
    await run(db, "T-E2");
    expect(approveDecision(db, { ticketId: "T-E2", persona: "reviewer" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(counts(db)).toEqual({ outbox: 0, audit: 0 });
  });

  test("a Decision with no validated reply cannot be approved", async () => {
    const db = seededDb();
    await runCase(db, "T-E2"); // rules only: no model, no reply
    expect(approveDecision(db, { ticketId: "T-E2", persona: "specialist" })).toMatchObject({ ok: false, code: "needs_human" });
  });
});

describe("Persona gates", () => {
  test("a Specialist cannot approve a needs_lead Case; a Lead can approve an over-Cap one", async () => {
    const db = seededDb();
    const d = await run(db, "T-E12");
    expect(d.status).toBe("needs_lead");
    expect(approveDecision(db, { ticketId: "T-E12", persona: "specialist" })).toMatchObject({ ok: false, code: "needs_lead" });
    expect(counts(db)).toEqual({ outbox: 0, audit: 0 });
    const ok = approveDecision(db, { ticketId: "T-E12", persona: "lead" });
    expect(ok.ok).toBe(true);
    expect(mine(db, "T-E12").find((x) => x.system === "orb")!.payload).toMatchObject({ body: { amount: 50 } });
  });

  test("a Lead can approve a Chargeback bump; a Specialist cannot", async () => {
    const db = seededDb();
    const d = await run(db, "T-E17");
    expect([d.capStatus, d.status]).toEqual(["chargeback_bump", "needs_lead"]);
    expect(approveDecision(db, { ticketId: "T-E17", persona: "specialist" })).toMatchObject({ ok: false, code: "needs_lead" });
    expect(approveDecision(db, { ticketId: "T-E17", persona: "lead" }).ok).toBe(true);
  });

  test("no one can approve Enterprise", async () => {
    const db = seededDb();
    await run(db, "T-E13");
    for (const persona of ["specialist", "lead"] as const) {
      expect(approveDecision(db, { ticketId: "T-E13", persona })).toMatchObject({ ok: false, code: "recommend_only" });
    }
  });

  test("no one can exceed the Cap, even a Lead, when the Cap has since been used up", async () => {
    const db = seededDb();
    await run(db, "T-E12");
    db.update(schema.accounts).set({ creditsGranted30dCents: 4500 }).where(eq(schema.accounts.id, "A-E12")).run();
    expect(approveDecision(db, { ticketId: "T-E12", persona: "lead" })).toMatchObject({ ok: false, code: "over_cap" });
  });

  test("a flagged Checkpoint must be settled by a person first, then the Case can be approved", async () => {
    const db = seededDb();
    const d = await run(db, "T-E5");
    expect(d.status).toBe("needs_human");
    expect(approveDecision(db, { ticketId: "T-E5", persona: "lead" })).toMatchObject({ ok: false, code: "needs_human" });
    const o = await overrideDecision(db, { ticketId: "T-E5", persona: "specialist", kind: "label", checkpointId: "S-E5-c3", to: "scope_overrun", reason: "57 files for a style tweak, confirmed" }, { provider });
    expect(o.ok).toBe(true);
    expect(loadDecision(db, "T-E5")!.status).toBe("ready");
    expect(approveDecision(db, { ticketId: "T-E5", persona: "specialist" }).ok).toBe(true);
    expect(mine(db, "T-E5").find((x) => x.system === "orb")!.payload).toMatchObject({ body: { amount: 12.5 } });
  });
});

describe("Overrides", () => {
  test("an Override without a reason is rejected and changes nothing", async () => {
    const db = seededDb();
    const d = await run(db, "T-E4");
    for (const reason of ["", "   ", "x"]) {
      const r = await overrideDecision(db, { ticketId: "T-E4", persona: "specialist", kind: "label", checkpointId: "S-E4-c3", to: "delivered", reason }, { provider });
      expect(r).toMatchObject({ ok: false, code: "bad_payload" });
    }
    expect(loadDecision(db, "T-E4")!.amountCents).toBe(d.amountCents);
    expect(counts(db).audit).toBe(0);
  });

  test("with a reason, it changes the Decision, is audited and is queued for the eval backlog", async () => {
    const db = seededDb();
    await run(db, "T-E4");
    const r = await overrideDecision(db, { ticketId: "T-E4", persona: "specialist", kind: "label", checkpointId: "S-E4-c3", to: "delivered", reason: "the login test was flaky, I re-ran it" }, { provider });
    expect(r.ok).toBe(true);
    const d = loadDecision(db, "T-E4")!;
    expect(d.labels.find((l) => l.checkpointId === "S-E4-c3")).toMatchObject({ label: "delivered", source: "human" });
    expect(d.amountCents).toBe(0);
    expect(d.overrideReason).toBe("the login test was flaky, I re-ran it");
    const audit = db.select().from(schema.auditLog).all().filter((a) => !(a.payload as { seeded?: boolean }).seeded);
    expect(audit.map((a) => [a.actor, a.action])).toEqual([["specialist", "override"]]);
    const backlog = exportOverrideBacklog(db);
    expect(backlog).toHaveLength(1);
    expect(backlog[0]).toMatchObject({ ticketId: "T-E4", checkpointId: "S-E4-c3", from: "false_completion", to: "delivered", reason: "the login test was flaky, I re-ran it" });
    expect(backlog[0]!.checkpoint).toMatchObject({ id: "S-E4-c3" });
  });

  test("an amount Override lowers the Credit, keeps lines summing to the cent, and cannot pass the ceiling", async () => {
    const db = seededDb();
    await run(db, "T-E6");
    const over = await overrideDecision(db, { ticketId: "T-E6", persona: "specialist", kind: "amount", to: 99999999, reason: "too generous" }, { provider });
    expect(over).toMatchObject({ ok: false });
    const ok = await overrideDecision(db, { ticketId: "T-E6", persona: "specialist", kind: "amount", to: 5000, reason: "customer accepted a smaller amount" }, { provider });
    expect(ok.ok).toBe(true);
    const d = loadDecision(db, "T-E6")!;
    expect(d.amountCents).toBe(5000);
    expect(d.lines.reduce((a, l) => a + l.creditCents, 0)).toBe(5000);
    expect(d.reply).toContain("$50.00");
  });

  test("a Reviewer may not override, and an approved Decision cannot be overridden", async () => {
    const db = seededDb();
    await run(db, "T-E2");
    expect(await overrideDecision(db, { ticketId: "T-E2", persona: "reviewer", kind: "amount", to: 0, reason: "just because" })).toMatchObject({ ok: false, code: "forbidden" });
    approveDecision(db, { ticketId: "T-E2", persona: "specialist" });
    expect(await overrideDecision(db, { ticketId: "T-E2", persona: "specialist", kind: "amount", to: 0, reason: "changed my mind" })).toMatchObject({ ok: false, code: "already_approved" });
  });
});

describe("audit log", () => {
  async function withRows() {
    const db = seededDb();
    await run(db, "T-E2");
    await run(db, "T-E3");
    approveDecision(db, { ticketId: "T-E2", persona: "specialist" });
    approveDecision(db, { ticketId: "T-E3", persona: "lead" });
    appendAudit(db, { actor: "lead", action: "note", payload: { n: 1 } });
    return db;
  }

  test("is hash-chained and verifies", async () => {
    const db = await withRows();
    expect(verifyAuditChain(db)).toEqual({ ok: true, rows: 4 });
    const rows = db.select().from(schema.auditLog).all();
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[0]!.prevHash).toBe("GENESIS");
  });

  test("refuses UPDATE and DELETE: there is no deletion path", async () => {
    const db = await withRows();
    const message = (fn: () => void) => {
      try { fn(); } catch (e) { return `${(e as Error).message} ${((e as { cause?: Error }).cause?.message) ?? ""}`; }
      return "no error";
    };
    expect(message(() => db.run(sql`update audit_log set actor = 'x' where id = 1`))).toMatch(/append-only/);
    expect(message(() => db.run(sql`delete from audit_log where id = 1`))).toMatch(/append-only/);
    expect(db.select().from(schema.auditLog).all()).toHaveLength(4);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  test("tampering with any row is detected by verifying the chain", async () => {
    for (const tamper of [
      `update audit_log set payload = '{"decisionId":"x"}' where id = 3`,
      `update audit_log set actor = 'someone-else' where id = 2`,
      `update audit_log set hash = 'deadbeef' where id = 1`,
      `update audit_log set prev_hash = 'deadbeef' where id = 4`,
      `delete from audit_log where id = 2`,
    ]) {
      const db = await withRows();
      db.run(sql.raw("DROP TRIGGER audit_log_no_update"));
      db.run(sql.raw("DROP TRIGGER audit_log_no_delete"));
      db.run(sql.raw(tamper));
      expect([tamper, verifyAuditChain(db).ok]).toEqual([tamper, false]);
    }
  });
});

describe("mock payload shapes", () => {
  test("the Orb entry is a valid increment at cost basis 0; an amendment against a block is also valid; malformed payloads are rejected", () => {
    const base = { endpoint: "POST /v1/customers/cus_1/credits/ledger_entry" };
    expect(validateMockPayload("orb", { ...base, body: { entry_type: "amendment", amount: 5, block_id: "blk_1", description: "x" } }).ok).toBe(true);
    expect(validateMockPayload("orb", { ...base, body: { entry_type: "increment", amount: 5, per_unit_cost_basis: "1", description: "x", metadata: {} } }).ok).toBe(false);
    expect(validateMockPayload("orb", { ...base, body: { entry_type: "increment", amount: -5, per_unit_cost_basis: "0", description: "x" } }).ok).toBe(false);
    expect(validateMockPayload("zendesk", { endpoint: "PUT /api/v2/tickets/T-1.json", body: { ticket: { comment: { body: "hi", public: false }, tags: ["a"], status: "solved" } } }).ok).toBe(false);
    expect(validateMockPayload("linear", { endpoint: "POST https://api.linear.app/graphql", body: { query: "nothing", variables: {} } }).ok).toBe(false);
  });

  test("approving the known-bug Graded session writes a Linear issue with Session and Checkpoint IDs; others write none", async () => {
    const db = seededDb();
    await run(db, "T-E8");
    await run(db, "T-E2");
    expect(approveDecision(db, { ticketId: "T-E8", persona: "specialist" }).ok).toBe(true);
    expect(approveDecision(db, { ticketId: "T-E2", persona: "specialist" }).ok).toBe(true);
    const linear = db.select().from(schema.outbox).where(eq(schema.outbox.system, "linear")).all();
    expect(linear).toHaveLength(1);
    const desc = (linear[0]!.payload as { body: { variables: { input: { description: string; labelNames: string[] } } } }).body.variables.input;
    expect(desc.description).toContain("S-E8");
    expect(desc.description).toContain("S-E8-c3");
    expect(desc.labelNames).toContain("agent-billing");
  });
});
