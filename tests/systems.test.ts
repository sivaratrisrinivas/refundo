import { describe, expect, test } from "bun:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { AUTH_COOKIE, PERSONA_COOKIE, authToken } from "@/lib/auth/cookies";
import { resetDemo } from "@/lib/data/seed";
import { schema, useDb } from "@/lib/db/client";
import { listOutbox } from "@/lib/db/systems";
import { errorFreeModel } from "@/lib/models";
import { verifyAuditChain } from "@/lib/audit";
import { approveDecision, overrideDecision } from "@/lib/pipeline/approve";
import { runCase } from "@/lib/pipeline/run";
import { POST as resetRoute } from "@/app/api/demo/reset/route";
import { GET as orbGet, POST as orbPost } from "@/app/api/mock/orb/ledger/route";
import { GET as zdGet } from "@/app/api/mock/zendesk/tickets/route";
import { POST as linearPost } from "@/app/api/mock/linear/issues/route";
import { seededDb } from "./helpers";

const provider = errorFreeModel("sim-a");
const req = (persona: string, method = "POST", body?: unknown, authed = true) =>
  new Request("http://x/api", {
    method,
    headers: { cookie: [authed ? `${AUTH_COOKIE}=${authToken()}` : "", `${PERSONA_COOKIE}=${persona}`].filter(Boolean).join("; "), "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });

describe("duplicate Tickets", () => {
  test("the duplicate-Ticket Graded session creates no second Credit write and its reply references the earlier Credit", async () => {
    const db = seededDb();
    const orbBefore = listOutbox(db, "orb");
    expect(orbBefore).toHaveLength(1); // the earlier Credit
    const d = await runCase(db, "T-E16", { provider });
    expect(d.amountCents).toBe(0);
    expect(d.reply).toMatch(/already credited \$15\.00 on 2026-09-30/);
    const r = approveDecision(db, { ticketId: "T-E16", persona: "specialist" });
    expect(r).toMatchObject({ ok: true, written: ["zendesk"] });
    expect(listOutbox(db, "orb")).toEqual(orbBefore);
    expect(listOutbox(db, "linear")).toHaveLength(0);
    const zd = listOutbox(db, "zendesk");
    expect(zd).toHaveLength(2);
    expect((zd[0]!.payload as { body: { ticket: { tags: string[] } } }).body.ticket.tags).toContain("no_credit_issued");
    const acct = db.select().from(schema.accounts).all().find((a) => a.id === "A-E16")!;
    expect(acct.creditsGranted30dCents).toBe(1500);
  });
});

describe("Systems page data", () => {
  test("entries are listed newest first and a new Approval appears", async () => {
    const db = seededDb();
    for (const t of ["T-E2", "T-E3"]) {
      await runCase(db, t, { provider });
      approveDecision(db, { ticketId: t, persona: "specialist" });
    }
    const orb = listOutbox(db, "orb");
    expect(orb.map((r) => r.decisionId)).toEqual(["D-T-E3", "D-T-E2", "D-E16-prior"]);
  });

  test("the mock endpoints list entries, validate payload shape and reject malformed payloads", async () => {
    const db = seededDb();
    useDb(db);
    const got = (await (await orbGet(req("reviewer", "GET"))).json()) as { entries: unknown[]; simulated: boolean };
    expect(got.simulated).toBe(true);
    expect(got.entries).toHaveLength(1);
    expect(((await (await zdGet(req("specialist", "GET"))).json()) as { entries: unknown[] }).entries).toHaveLength(1);
    const good = { endpoint: "POST /v1/customers/cus_1/credits/ledger_entry", body: { entry_type: "increment", amount: 5, per_unit_cost_basis: "0", description: "x", metadata: { decision_id: "d", session_id: "s", ticket_id: "t", clause_ids: [], policy_version: "v" } } };
    expect((await orbPost(req("specialist", "POST", good))).status).toBe(200);
    expect((await orbPost(req("specialist", "POST", { ...good, body: { ...good.body, per_unit_cost_basis: "2" } }))).status).toBe(422);
    expect((await linearPost(req("specialist", "POST", { nonsense: true }))).status).toBe(422);
    expect(listOutbox(db, "orb")).toHaveLength(1); // validation never records anything
    expect((await orbGet(req("specialist", "GET", undefined, false))).status).toBe(401);
  });
});

describe("demo reset", () => {
  const rowsOf = (db: ReturnType<typeof seededDb>) =>
    Object.fromEntries(
      Object.values(schema)
        .filter((t) => typeof t === "object" && "id" in getTableColumns(t as never))
        .map((t) => [getTableName(t as never), db.select().from(t as never).all()]),
    );

  test("returns the database to the exact seeded state and clears writes and audit rows made since", async () => {
    const db = seededDb();
    for (const t of ["T-E2", "T-E4", "T-E8", "T-E12"]) {
      await runCase(db, t, { provider });
    }
    await overrideDecision(db, { ticketId: "T-E4", persona: "specialist", kind: "label", checkpointId: "S-E4-c3", to: "delivered", reason: "login test was flaky" }, { provider });
    approveDecision(db, { ticketId: "T-E2", persona: "specialist" });
    approveDecision(db, { ticketId: "T-E8", persona: "specialist" });
    expect(listOutbox(db, "linear")).toHaveLength(1);
    expect(db.select().from(schema.auditLog).all().length).toBeGreaterThan(1);

    resetDemo(db);
    expect(rowsOf(db)).toEqual(rowsOf(seededDb()));
    expect(listOutbox(db, "linear")).toHaveLength(0);
    expect(listOutbox(db, "orb")).toHaveLength(1);
    expect(db.select().from(schema.decisions).all()).toHaveLength(1);
    expect(verifyAuditChain(db)).toEqual({ ok: true, rows: 1 });
    // and it is usable again
    await runCase(db, "T-E2", { provider });
    expect(approveDecision(db, { ticketId: "T-E2", persona: "specialist" }).ok).toBe(true);
  });

  test("the reset route is Lead and Reviewer only", async () => {
    const db = seededDb();
    useDb(db);
    await runCase(db, "T-E2", { provider });
    expect((await resetRoute(req("specialist"))).status).toBe(403);
    expect(db.select().from(schema.decisions).all()).toHaveLength(2);
    expect((await resetRoute(req("reviewer"))).status).toBe(200);
    expect(db.select().from(schema.decisions).all()).toHaveLength(1);
  });
});
