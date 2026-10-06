import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestDb, schema } from "@/lib/db/client";
import { DEMO_NOW_ISO, now } from "@/lib/clock";
import { AUTH_COOKIE, PERSONA_COOKIE, authToken } from "@/lib/auth/cookies";
import { can, PERSONAS } from "@/lib/auth/personas";
import { POST as resetRoute } from "@/app/api/demo/reset/route";

function req(persona: string | null, authed = true): Request {
  const cookies = [authed ? `${AUTH_COOKIE}=${authToken()}` : "", persona ? `${PERSONA_COOKIE}=${persona}` : ""]
    .filter(Boolean)
    .join("; ");
  return new Request("http://x/api/demo/reset", { method: "POST", headers: { cookie: cookies } });
}

describe("database", () => {
  test("migrates an empty in-memory database with all ten tables", () => {
    const db = createTestDb();
    const rows = db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      "accounts", "audit_log", "bug_signatures", "checkpoints", "decisions",
      "eval_runs", "incidents", "outbox", "sessions", "tickets",
    ]);
  });

  test("a row round-trips through the app driver", () => {
    const db = createTestDb();
    db.insert(schema.accounts)
      .values({ id: "a1", name: "Acme", plan: "pro", tenureDays: 30, orbCustomerId: "cus_1" })
      .run();
    expect(db.select().from(schema.accounts).all()[0]?.plan).toBe("pro");
  });
});

describe("clock", () => {
  test("now is the frozen demo instant", () => {
    expect(now().toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(DEMO_NOW_ISO).toBe("2026-10-06T12:00:00.000Z");
  });
});

describe("server-side role enforcement", () => {
  test("no passcode cookie is rejected with 401", async () => {
    expect((await resetRoute(req("lead", false))).status).toBe(401);
  });

  test("a Specialist is refused demo reset even if the browser sends it", async () => {
    expect((await resetRoute(req("specialist"))).status).toBe(403);
  });

  test("a Lead passes the gate", async () => {
    expect((await resetRoute(req("lead"))).status).not.toBe(403);
  });

  test("permissions differ per Persona", () => {
    expect(PERSONAS.map((p) => can(p, "decision.approve_lead"))).toEqual([false, true, false]);
    expect(can("reviewer", "decision.approve")).toBe(false);
  });
});
