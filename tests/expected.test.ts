import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { price } from "@/lib/policy/engine";
import type { CheckpointLabel, Label, Mode, Plan } from "@/lib/policy/types";

interface ExpectedCheckpoint {
  seq: number; mode: Mode; costCents: number; excluded: boolean; label: Label | null;
  labelSource: "rule" | "model" | null; mustCite: string[]; creditCents: number;
  plant: Record<string, unknown>;
}
interface ExpectedSession {
  caseId: string; sessionId: string; failurePattern: string; ticketStance: string;
  accountSituation: string; evidenceClarity: string;
  account: { plan: Plan; creditsGranted30dCents: number };
  ticket: { disputeThreatened: boolean; injectionExpected: boolean };
  priorCredit: { amountCents: number } | null;
  checkpoints: ExpectedCheckpoint[];
  expected: {
    subtotalCents: number; amountCents: number; status: string; capStatus: string;
    clauses: string[]; linearIssue: boolean; injectionDetected: boolean; duplicateOfCredited: boolean;
  };
}
const doc = JSON.parse(readFileSync("eval/expected.json", "utf8")) as {
  dimensions: Record<string, string[]>; sessions: ExpectedSession[]; crossCuttingChecks: { id: string }[];
};
const bySession = (id: string) => doc.sessions.find((s) => s.caseId === id)!;

function reprice(s: ExpectedSession) {
  const labels: CheckpointLabel[] = s.checkpoints
    .filter((c) => !c.excluded)
    .map((c) => ({
      checkpointId: `c${c.seq}`, label: c.label!, evidenceFields: [], source: c.labelSource!, confidence: 1,
      repeat: typeof c.plant.repeat === "number" ? c.plant.repeat : undefined,
    }));
  return price({
    checkpoints: s.checkpoints.map((c) => ({ id: `c${c.seq}`, seq: c.seq, costCents: c.costCents, mode: c.mode })),
    labels,
    account: { plan: s.account.plan, creditsGranted30dCents: s.account.creditsGranted30dCents },
    disputeThreatened: s.ticket.disputeThreatened,
  });
}

describe("expected answers", () => {
  test("there are 20 Graded sessions: E1 to E17 plus three boundary sessions", () => {
    expect(doc.sessions.map((s) => s.caseId)).toEqual([
      ...Array.from({ length: 17 }, (_, i) => `E${i + 1}`), "B1", "B2", "B3",
    ]);
  });

  test("three cross-cutting checks are assertions, not sessions", () => {
    expect(doc.crossCuttingChecks.map((c) => c.id)).toEqual(["E18", "E19", "E20"]);
  });

  test("every value belongs to one of the four dimensions", () => {
    for (const s of doc.sessions) {
      expect(doc.dimensions.failurePattern).toContain(s.failurePattern);
      expect(doc.dimensions.ticketStance).toContain(s.ticketStance);
      expect(doc.dimensions.accountSituation).toContain(s.accountSituation);
      expect(doc.dimensions.evidenceClarity).toContain(s.evidenceClarity);
    }
  });

  for (const s of doc.sessions) {
    test(`${s.caseId}: the committed amount, status and Credit lines match the pricing engine's rules`, () => {
      const r = reprice(s);
      if (s.expected.duplicateOfCredited) {
        // A duplicate Ticket is priced for its Labels but credits nothing a second time.
        expect(s.expected.amountCents).toBe(0);
        expect(r.amountCents).toBeGreaterThan(0);
        expect(s.priorCredit?.amountCents).toBe(r.amountCents);
        return;
      }
      expect(r.subtotalCents).toBe(s.expected.subtotalCents);
      expect(r.amountCents).toBe(s.expected.amountCents);
      expect(r.status).toBe(s.expected.status as never);
      expect(r.capStatus).toBe(s.expected.capStatus as never);
      expect(r.clauses).toEqual(s.expected.clauses as never);
      expect(r.fileLinear).toBe(s.expected.linearIssue);
      const sum = s.checkpoints.reduce((a, c) => a + c.creditCents, 0);
      expect(sum).toBe(s.expected.amountCents);
      for (const line of r.lines) {
        expect(s.checkpoints.find((c) => c.seq === line.seq)!.creditCents).toBe(line.creditCents);
      }
    });
  }

  test("the mixed session's expected Credit is the worked-example sum", () => {
    const e6 = bySession("E6");
    expect(e6.checkpoints.reduce((a, c) => a + c.costCents, 0)).toBe(16411);
    expect(e6.expected.amountCents).toBe(7105);
    expect(e6.account.plan).toBe("pro");
    expect(e6.account.creditsGranted30dCents).toBe(4000);
  });

  test("the injection session's expected amount is the amount with no injection present", () => {
    const e14 = bySession("E14");
    expect(e14.ticket.injectionExpected).toBe(true);
    expect(e14.expected.amountCents).toBe(1400);
    expect(reprice(e14).amountCents).toBe(1400); // the engine takes no Ticket text at all
  });

  test("a failed-test rollback outside the 30-minute window is expected as unknown", () => {
    const b1 = bySession("B1");
    const outside = b1.checkpoints.find((c) => c.plant.rollbackAfterMin === 31)!;
    const inside = b1.checkpoints.find((c) => c.plant.rollbackAfterMin === 30)!;
    expect(outside.label).toBe("unknown");
    expect(inside.label).toBe("reverted_after_fail");
    expect(b1.expected.status).toBe("needs_human");
  });

  test("boundary sessions sit on both sides of each threshold", () => {
    const b2 = bySession("B2").checkpoints;
    expect(b2.find((c) => c.plant.files === 27)!.label).toBe("delivered"); // 9x median of 3
    expect(b2.find((c) => c.plant.files === 30)!.label).toBe("scope_overrun"); // 10x
    const b3 = bySession("B3").checkpoints;
    expect(b3.filter((c) => c.label === "loop").map((c) => c.seq)).toEqual([6]);
  });

  test("Free Mode Checkpoints are excluded and credit nothing", () => {
    const e11 = bySession("E11");
    const free = e11.checkpoints.filter((c) => c.mode === "free");
    expect(free.length).toBe(3);
    expect(free.every((c) => c.excluded && c.costCents === 0 && c.creditCents === 0)).toBe(true);
  });

  test("every Label records the Checkpoint fields it must cite", () => {
    for (const s of doc.sessions) {
      for (const c of s.checkpoints.filter((x) => !x.excluded && x.label !== "unknown")) {
        expect(c.mustCite.length).toBeGreaterThan(0);
      }
    }
  });

  test("no expected answer contains a transcript", () => {
    const raw = readFileSync("eval/expected.json", "utf8");
    expect(raw).not.toMatch(/requestText|agentClaimText":/);
  });
});
