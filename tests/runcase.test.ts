import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db/client";
import { assembleCase } from "@/lib/pipeline/assemble";
import { loadDecision, saveDecision } from "@/lib/pipeline/store";
import { runCase } from "@/lib/pipeline/run";
import { runSignals, loopRuns } from "@/lib/pipeline/signals";
import { loadPolicy } from "@/lib/policy/policy";
import type { Checkpoint } from "@/lib/policy/types";
import { cpId, GRADED, seededDb } from "./helpers";

const policy = loadPolicy();

function cp(over: Partial<Checkpoint> & { seq: number }): Checkpoint {
  return {
    id: `x${over.seq}`, sessionId: "S-X", ts: "2026-09-10T10:00:00.000Z", mode: "power", model: "m", reasoningEffort: "medium",
    costCents: 1000, requestText: "Add the thing", agentClaimText: "Added the thing.", filesChanged: ["src/a.ts"], linesAdded: 3,
    linesRemoved: 1, appTest: { ran: true, passed: true, failedSteps: [] }, rolledBackAt: null, errorText: null,
    errorSignature: null, orbBlockId: "b", planMode: false, ...over,
  };
}

describe("rule-decidable Graded sessions", () => {
  const db = seededDb();
  for (const s of GRADED) {
    test(`${s.caseId}: rule Labels match, model-expected Checkpoints are left unresolved, free mode is excluded`, async () => {
      const d = await runCase(db, s.ticketId);
      const byCp = new Map(d.labels.map((l) => [l.checkpointId, l]));
      const unresolved: string[] = [];
      for (const e of s.checkpoints) {
        const id = cpId(s, e.seq);
        if (e.excluded) {
          expect(byCp.has(id)).toBe(false);
          expect(d.unresolved).not.toContain(id);
        } else if (e.labelSource === "rule") {
          const got = byCp.get(id);
          expect([id, got?.label, got?.source]).toEqual([id, e.label as never, "rule"]);
          for (const f of e.mustCite ?? []) expect(got?.evidenceFields as string[]).toContain(f);
        } else {
          expect(byCp.has(id)).toBe(false);
          unresolved.push(id);
        }
      }
      expect(d.unresolved).toEqual(unresolved);
    });
  }

  test("sessions with no model-judged Checkpoint price to the expected Credit, status and Cap status", async () => {
    const ruleOnly = GRADED.filter((s) => s.checkpoints.every((e) => e.excluded || e.labelSource === "rule" || e.label === "delivered"));
    expect(ruleOnly.length).toBeGreaterThan(10);
    for (const s of ruleOnly) {
      const d = await runCase(db, s.ticketId);
      expect([s.caseId, d.amountCents]).toEqual([s.caseId, s.expected.amountCents]);
      expect([s.caseId, d.capStatus]).toEqual([s.caseId, s.expected.capStatus as never]);
      expect([s.caseId, d.clauses.filter((c) => c !== "C1")]).toEqual([s.caseId, s.expected.clauses.filter((c) => c !== "C1")]);
      expect([s.caseId, d.fileLinear]).toEqual([s.caseId, s.expected.linearIssue]);
    }
  });

  test("with the model-judged Checkpoints decided by a person, every Graded session prices exactly as expected", async () => {
    for (const s of GRADED) {
      const d0 = await runCase(db, s.ticketId);
      const overrides = d0.unresolved.map((id) => {
        const e = s.checkpoints.find((x) => cpId(s, x.seq) === id)!;
        return { kind: "label" as const, checkpointId: id, from: "unresolved", to: e.label!, reason: "test", actor: "specialist", ts: "t" };
      });
      saveDecision(db, { ...d0, overrides });
      const d = await runCase(db, s.ticketId);
      expect([s.caseId, d.amountCents]).toEqual([s.caseId, s.expected.amountCents]);
      expect([s.caseId, d.status]).toEqual([s.caseId, s.expected.status === "needs_human" ? d.status : (s.expected.status as never)]);
      expect([s.caseId, d.capStatus]).toEqual([s.caseId, s.expected.capStatus as never]);
      const sum = d.lines.reduce((a, l) => a + l.creditCents, 0);
      expect(sum).toBe(d.amountCents);
      // reset for later tests
      saveDecision(db, { ...d, overrides: [] });
    }
  });
});

describe("signals and precedence", () => {
  test("when several rules match, the fixed precedence picks one Label and keeps the rest as secondary evidence", () => {
    const bug = { id: "b1", name: "n", pattern: "duplicated file content", linearIssueRef: "A-1" };
    const inc = { id: "i1", title: "t", startsAt: "2026-09-10T09:00:00Z", endsAt: "2026-09-10T11:00:00Z", sourceUrl: "u" };
    const c = cp({
      seq: 1, errorText: "duplicated file content found", appTest: { ran: true, passed: false, failedSteps: ["x"] },
      rolledBackAt: "2026-09-10T10:10:00.000Z",
    });
    const [r] = runSignals([c], [inc], [bug], policy);
    expect(r!.label!.label).toBe("known_bug");
    expect(r!.alsoMatched.sort()).toEqual(["incident_overlap", "reverted_after_fail"]);
    const noBug = runSignals([c], [inc], [], policy)[0]!;
    expect(noBug.label!.label).toBe("incident_overlap");
  });

  test("a revert at 30 minutes is credited and at 31 minutes is unknown", () => {
    const mk = (min: number) =>
      cp({ seq: 1, appTest: { ran: true, passed: false, failedSteps: ["s"] }, rolledBackAt: new Date(Date.parse("2026-09-10T10:00:00Z") + min * 60000).toISOString() });
    expect(runSignals([mk(29)], [], [], policy)[0]!.label!.label).toBe("reverted_after_fail");
    expect(runSignals([mk(30)], [], [], policy)[0]!.label!.label).toBe("reverted_after_fail");
    const late = runSignals([mk(31)], [], [], policy)[0]!;
    expect(late.label!.label).toBe("unknown");
    expect(late.label!.source).toBe("rule");
  });

  test("a loop is labeled from exactly the third repeat; two repeats are not a loop", () => {
    const two = [1, 2].map((n) => cp({ seq: n, errorText: "boom", errorSignature: "sig" }));
    expect(loopRuns(two).size).toBe(0);
    const three = [1, 2, 3].map((n) => cp({ seq: n, errorText: "boom", errorSignature: "sig" }));
    const r = runSignals(three, [], [], policy);
    expect(r.map((x) => x.label?.label ?? null)).toEqual([null, null, "loop"]);
    expect(r.map((x) => x.note ?? null)).toEqual(["repeat 1 of 3", "repeat 2 of 3", null]);
  });

  test("a gap breaks the run", () => {
    const cps = [1, 2, 4, 5].map((n) => cp({ seq: n, errorText: "boom", errorSignature: "sig" }));
    expect(loopRuns(cps).size).toBe(0);
  });

  test("scope overrun at 9 versus 10 times the median", () => {
    const files = (n: number) => Array.from({ length: n }, (_, i) => `f${i}.ts`);
    const mk = (n: number) => cp({ seq: 1, requestText: "tweak the footer colors", filesChanged: files(n) });
    expect(runSignals([mk(27)], [], [], policy)[0]!.label).toBeNull();
    expect(runSignals([mk(30)], [], [], policy)[0]!.label!.label).toBe("scope_overrun");
  });

  test("free-mode Checkpoints are excluded and never labeled", () => {
    const r = runSignals([cp({ seq: 1, mode: "free", costCents: 0, appTest: { ran: true, passed: false, failedSteps: ["s"] }, rolledBackAt: "2026-09-10T10:05:00.000Z" })], [], [], policy)[0]!;
    expect(r.excluded).toBe(true);
    expect(r.label).toBeNull();
  });
});

describe("case seam behavior", () => {
  test("the same Case run twice yields an identical stored Decision", async () => {
    const db = seededDb();
    const a = await runCase(db, "T-E6");
    const stored1 = JSON.stringify(loadDecision(db, "T-E6"));
    const b = await runCase(db, "T-E6");
    expect(b).toEqual(a);
    expect(JSON.stringify(loadDecision(db, "T-E6"))).toBe(stored1);
  });

  test("a Ticket with no Session needs a human", async () => {
    const db = seededDb();
    db.update(schema.tickets).set({ sessionId: null }).where(eq(schema.tickets.id, "T-E1")).run();
    const d = await runCase(db, "T-E1");
    expect(d.status).toBe("needs_human");
    expect(d.amountCents).toBe(0);
  });

  test("an approved Decision is never recomputed", async () => {
    const db = seededDb();
    const d = await runCase(db, "T-E2");
    saveDecision(db, { ...d, status: "approved", approver: "specialist" });
    const again = await runCase(db, "T-E2");
    expect(again.status).toBe("approved");
  });

  test("the Ticket text moves no money: the injection Ticket prices like the same Session without it", async () => {
    const db = seededDb();
    const withInjection = await runCase(db, "T-E14");
    db.update(schema.tickets).set({ body: "Please look at the rolled back step." }).where(eq(schema.tickets.id, "T-E14")).run();
    const without = await runCase(db, "T-E14");
    expect(without.amountCents).toBe(withInjection.amountCents);
    expect(without.lines).toEqual(withInjection.lines);
    expect(without.labels).toEqual(withInjection.labels);
    expect(withInjection.amountCents).toBe(1400);
  });

  test("a second Ticket for an already-credited Session earns no second Credit", async () => {
    const db = seededDb();
    const d = await runCase(db, "T-E16");
    expect(d.amountCents).toBe(0);
    expect(d.priorCredit).toEqual({ amountCents: 1500, approvedOn: "2026-09-30" });
    expect(d.lines.every((l) => l.creditCents === 0)).toBe(true);
  });
});

describe("the pipeline's data path", () => {
  test("never selects or exposes the Failure pattern", () => {
    const db = seededDb();
    const c = assembleCase(db, "T-E5")!;
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/failurePattern|failure_pattern|scope_overrun"/);
    expect(json).not.toMatch(/"graded"/);
    for (const f of ["lib/pipeline/assemble.ts", "lib/pipeline/signals.ts", "lib/pipeline/run.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/failurePattern|failure_pattern/);
    }
  });
});
