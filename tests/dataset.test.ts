import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { generateDataset, type ExpectedFile } from "@/lib/data/generate";
import { loadDatasetFile, seedDb, clearAll } from "@/lib/data/seed";
import { createTestDb, schema } from "@/lib/db/client";
import { errorSignature } from "@/lib/pipeline/normalize";
import { listQueue } from "@/lib/db/queue";
import { revertWithinWindow } from "@/lib/policy/rules";
import { loadPolicy } from "@/lib/policy/policy";
import { minutesBetween } from "@/lib/clock";
import type { DatasetCheckpoint } from "@/lib/data/types";

const expectedRaw = readFileSync("eval/expected.json", "utf8");
interface ExpectedCp { seq: number; mode: "free" | "power" | "max"; costCents: number; label: string | null; excluded: boolean; plant: Record<string, unknown> }
type ExpectedSession = Omit<ExpectedFile["sessions"][number], "checkpoints"> & { checkpoints: ExpectedCp[] };
const expected = JSON.parse(expectedRaw) as { sessions: ExpectedSession[] };
const data = generateDataset(expected as unknown as ExpectedFile);
const policy = loadPolicy();

describe("seed reproducibility and counts", () => {
  test("generating twice gives identical data", () => {
    expect(generateDataset(expected as unknown as ExpectedFile)).toEqual(data);
  });
  test("the committed dataset.json is exactly what the generator produces from the committed text", () => {
    expect(loadDatasetFile().checkpoints.length).toBe(data.checkpoints.length);
    expect(loadDatasetFile().sessions).toEqual(data.sessions);
  });
  test("two seed runs on empty databases give identical rows", () => {
    const a = createTestDb(); const b = createTestDb();
    seedDb(a, data); seedDb(b, data);
    for (const t of [schema.accounts, schema.sessions, schema.checkpoints, schema.tickets, schema.incidents, schema.bugSignatures]) {
      expect(a.select().from(t).all()).toEqual(b.select().from(t).all());
    }
  });
  test("counts match the spec", () => {
    expect(data.sessions.length).toBe(40);
    expect(data.sessions.filter((s) => s.graded).length).toBe(20);
    expect(data.tickets.length).toBe(40);
    expect(data.accounts.length).toBe(30);
    expect(data.accounts.filter((a) => a.plan === "core").length).toBe(18);
    expect(data.accounts.filter((a) => a.plan === "pro").length).toBe(10);
    expect(data.accounts.filter((a) => a.plan === "enterprise").length).toBe(2);
    expect(data.incidents.length).toBe(4);
    expect(data.bugSignatures.length).toBe(3);
    expect(data.checkpoints.length).toBeGreaterThan(300);
    expect(data.checkpoints.length).toBeLessThan(340);
    expect(data.tickets.filter((t) => t.disputeThreatened).length).toBe(5);
    expect(data.tickets.filter((t) => /ignore your policy/i.test(t.body)).length).toBe(3);
    expect(data.accounts.filter((a) => a.priorDisputes > 0).length).toBe(3);
  });
  test("each session total is the sum of its Checkpoints", () => {
    for (const s of data.sessions) {
      const sum = data.checkpoints.filter((c) => c.sessionId === s.id).reduce((a, c) => a + c.costCents, 0);
      expect(sum).toBe(s.totalCostCents);
    }
  });
  test("incidents and bug signatures are marked synthetic until verified against their source", () => {
    expect(data.incidents.every((i) => i.synthetic && i.sourceUrl.startsWith("https://"))).toBe(true);
    expect(data.bugSignatures.filter((b) => !b.synthetic).length).toBe(0);
  });
});

// Independent checks: recompute facts from the structured fields only. The
// generator's inputs (the plants) are not used to decide these.
describe("graded sessions are consistent with their expected answers", () => {
  const cpsOf = (id: string): DatasetCheckpoint[] => data.checkpoints.filter((c) => c.sessionId === id).sort((a, b) => a.seq - b.seq);

  for (const s of expected.sessions) {
    test(`${s.caseId}: Checkpoint count, mode and cost match`, () => {
      const cps = cpsOf(s.sessionId);
      expect(cps.length).toBe(s.checkpoints.length);
      cps.forEach((c, i) => {
        expect(c.mode).toBe(s.checkpoints[i]!.mode);
        expect(c.costCents).toBe(s.checkpoints[i]!.costCents);
        if (c.mode === "free") expect(c.costCents).toBe(0);
      });
    });
  }

  test("reverted_after_fail Checkpoints have a failed test and a rollback inside the window; the 31-minute one is outside", () => {
    for (const s of expected.sessions) {
      const cps = cpsOf(s.sessionId);
      s.checkpoints.forEach((e, i) => {
        const c = cps[i]!;
        if (e.label === "reverted_after_fail") {
          expect(c.appTest.passed).toBe(false);
          expect(revertWithinWindow(minutesBetween(c.ts, c.rolledBackAt!), policy)).toBe(true);
        }
        if (s.caseId === "B1" && e.plant.rollbackAfterMin === 31) {
          expect(c.appTest.passed).toBe(false);
          expect(minutesBetween(c.ts, c.rolledBackAt!)).toBe(31);
        }
      });
    }
  });

  test("loop Checkpoints share one normalized signature across 3+ consecutive Checkpoints; exact 2-repeat run does not qualify", () => {
    const run = (id: string) => {
      const sigs = cpsOf(id).map((c) => c.errorSignature);
      const runs: number[] = [];
      let n = 0;
      sigs.forEach((sg, i) => {
        if (sg && i > 0 && sigs[i - 1] === sg) n++; else { if (n > 0) runs.push(n + 1); n = sg ? 0 : 0; }
      });
      if (n > 0) runs.push(n + 1);
      return runs;
    };
    expect(run("S-E3")).toEqual([4]);
    expect(run("S-B3")).toEqual([2, 3]);
    expect(run("S-E6")).toEqual([4]);
  });

  test("error signatures ignore line numbers, paths and hex addresses", () => {
    expect(errorSignature("TypeError at /a/b/c.tsx:20:7")).toBe(errorSignature("TypeError at /x/y/z.tsx:99:1"));
    expect(errorSignature("boom 0x7f3a1")).toBe(errorSignature("boom 0xdeadbeef"));
    expect(errorSignature("boom")).not.toBe(errorSignature("bang"));
  });

  test("scope: 57 files for E5; 27 versus 30 files for the 9x and 10x boundary", () => {
    expect(cpsOf("S-E5")[2]!.filesChanged.length).toBe(57);
    expect(cpsOf("S-B2")[1]!.filesChanged.length).toBe(27);
    expect(cpsOf("S-B2")[2]!.filesChanged.length).toBe(30);
  });

  test("incident Checkpoints sit inside the window and error; the boundary Checkpoints before it do not", () => {
    const inc = data.incidents[0]!;
    const e7 = cpsOf("S-E7");
    for (const c of [e7[1]!, e7[2]!]) {
      expect(Date.parse(c.ts)).toBeGreaterThanOrEqual(Date.parse(inc.startsAt));
      expect(Date.parse(c.ts)).toBeLessThanOrEqual(Date.parse(inc.endsAt));
      expect(c.errorText).not.toBeNull();
    }
    expect(Date.parse(e7[0]!.ts)).toBeLessThan(Date.parse(inc.startsAt));
  });

  test("the known-bug Checkpoint matches the bug signature and the others do not", () => {
    const re = new RegExp(data.bugSignatures[0]!.pattern, "i");
    const e8 = cpsOf("S-E8");
    expect(e8.map((c) => re.test(c.errorText ?? ""))).toEqual([false, false, true, false, false]);
  });

  test("planning, user-choice rollback and missing evidence look the way their Labels require", () => {
    expect(cpsOf("S-E10").every((c) => c.planMode && c.filesChanged.length === 0)).toBe(true);
    const e9 = cpsOf("S-E9")[2]!;
    expect(e9.appTest.passed).toBe(true);
    expect(e9.rolledBackAt).not.toBeNull();
    expect(e9.errorText).toBeNull();
    const e15 = cpsOf("S-E15")[2]!;
    expect(!e15.appTest.ran && e15.filesChanged.length === 0 && e15.linesAdded + e15.linesRemoved === 0).toBe(true);
  });

  test("the E4 claim is contradicted: a failed login step and no auth or login file", () => {
    const c = cpsOf("S-E4")[2]!;
    expect(c.agentClaimText).toMatch(/login/i);
    expect(c.appTest.failedSteps.join(" ")).toMatch(/login/i);
    expect(c.filesChanged.some((f) => /login|auth/i.test(f))).toBe(false);
  });

  test("the already-credited session has a prior approved Credit", () => {
    expect(data.priorDecisions).toEqual([
      expect.objectContaining({ sessionId: "S-E16", amountCents: 1500, approvedOn: "2026-09-30" }),
    ]);
  });
});

describe("the pipeline's data path never sees the Failure pattern", () => {
  test("the Queue exposes no Failure pattern, and every Session stores one", () => {
    const db = createTestDb();
    seedDb(db, data);
    expect(JSON.stringify(listQueue(db))).not.toMatch(/failurePattern|failure_pattern|clean_delivered/);
    expect(db.select().from(schema.sessions).all().every((s) => s.failurePattern.length > 0)).toBe(true);
  });
});

describe("Queue", () => {
  const db = createTestDb();
  seedDb(db, data);
  const rows = listQueue(db);

  test("threatened-dispute Tickets sort to the top, then dispute history, then standard", () => {
    const risks = rows.map((r) => r.risk);
    expect(risks.slice(0, 5)).toEqual(["high", "high", "high", "high", "high"]);
    const firstNonHigh = risks.findIndex((r) => r !== "high");
    expect(risks.slice(firstNonHigh).includes("high")).toBe(false);
  });
  test("within a tier the oldest Ticket comes first", () => {
    const high = rows.filter((r) => r.risk === "high");
    expect(high.map((r) => r.ageHours)).toEqual([...high.map((r) => r.ageHours)].sort((a, b) => b - a));
  });
  test("each row carries plan, disputed amount, age and a risk badge", () => {
    for (const r of rows) {
      expect(["core", "pro", "enterprise"]).toContain(r.plan);
      expect(r.disputedCents).toBeGreaterThan(0);
      expect(r.ageHours).toBeGreaterThan(0);
      expect(["high", "watch", "normal"]).toContain(r.risk);
    }
  });
  test("the status filter works", () => {
    const first = db.select({ id: schema.tickets.id }).from(schema.tickets).limit(1).get()!;
    db.update(schema.tickets).set({ status: "approved" }).where(eq(schema.tickets.id, first.id)).run();
    expect(listQueue(db, { status: "approved" }).length).toBe(1);
    expect(listQueue(db, { status: "open" }).length).toBe(39);
    expect(listQueue(db).length).toBe(40);
  });
  test("clearAll empties the database", () => {
    clearAll(db);
    expect(listQueue(db).length).toBe(0);
  });
});
