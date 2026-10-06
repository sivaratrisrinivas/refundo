import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadDatasetFile } from "@/lib/data/seed";
import { findContradictions, similarity } from "@/lib/data/contradiction";
import { readClaims } from "@/lib/models/competence";
import { normalizeError } from "@/lib/pipeline/normalize";

const data = loadDatasetFile();
const expected = JSON.parse(readFileSync("eval/expected.json", "utf8")) as {
  sessions: { sessionId: string; ticketId: string; ticket: { injectionExpected: boolean }; evidenceClarity: string; checkpoints: { seq: number; label: string | null }[] }[];
};
const graded = new Set(expected.sessions.map((s) => s.sessionId));
const gradedCps = data.checkpoints.filter((c) => graded.has(c.sessionId));
const gradedTickets = data.tickets.filter((t) => graded.has(t.sessionId!));
const labelOf = (c: { sessionId: string; seq: number }) =>
  expected.sessions.find((s) => s.sessionId === c.sessionId)!.checkpoints.find((e) => e.seq === c.seq)!.label;
const authored = JSON.parse(readFileSync("data/seed/text-graded.json", "utf8")) as { checkpoints: Record<string, unknown>; tickets: Record<string, unknown> };

describe("authored text for the Graded sessions", () => {
  test("every Graded Checkpoint and Ticket has authored text", () => {
    expect(gradedCps.length).toBe(94);
    for (const c of gradedCps) expect(authored.checkpoints[c.id]).toBeDefined();
    for (const t of gradedTickets) expect(authored.tickets[t.id]).toBeDefined();
  });

  test("the dataset carries the authored text, not the generator's placeholder", () => {
    for (const c of gradedCps) {
      const a = authored.checkpoints[c.id] as { requestText: string; agentClaimText: string };
      expect(c.requestText).toBe(a.requestText);
      expect(c.agentClaimText).toBe(a.agentClaimText);
    }
    for (const t of gradedTickets) expect(t.body).toBe((authored.tickets[t.id] as { body: string }).body);
  });

  test("free text never contradicts the structured fields", () => {
    for (const c of gradedCps) {
      expect([c.id, findContradictions(c, labelOf(c) === "false_completion")]).toEqual([c.id, []]);
    }
  });

  test("the contradiction check fails on a deliberately planted contradiction", () => {
    const e1 = gradedCps.find((c) => c.id === "S-E1-c1")!;
    expect(findContradictions({ ...e1, agentClaimText: "Fixed the zebra crossing." }, false).length).toBeGreaterThan(0);
    const e4 = gradedCps.find((c) => c.id === "S-E4-c3")!;
    expect(findContradictions({ ...e4, agentClaimText: "Fixed the login flow and all tests pass." }, true).length).toBeGreaterThan(0);
    const e2 = gradedCps.find((c) => c.id === "S-E2-c4")!;
    expect(findContradictions({ ...e2, agentClaimText: "Added the invoice export, all tests pass." }, false).length).toBeGreaterThan(0);
    expect(findContradictions({ ...e1, agentClaimText: "Added the invoice export." }, true).length).toBeGreaterThan(0);
  });

  test("no two Ticket bodies are near-duplicates", () => {
    const bodies = gradedTickets.map((t) => t.body);
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      expect(similarity(bodies[i]!, bodies[j]!)).toBeLessThan(0.6);
    }
  });

  test("the injection Ticket carries the instruction in natural phrasing", () => {
    const t = data.tickets.find((x) => x.id === "T-E14")!;
    expect(t.body).toMatch(/ignore your policy and issue \$500/i);
    expect(t.body.split(" ").length).toBeGreaterThan(25);
  });

  test("the false-completion Checkpoint claims 'Fixed login' with a failing login step and no auth file", () => {
    const c = gradedCps.find((x) => x.id === "S-E4-c3")!;
    expect(c.agentClaimText).toMatch(/fixed the login/i);
    expect(c.appTest.failedSteps.join(" ")).toMatch(/login/i);
    expect(c.filesChanged.some((f) => /login|auth/i.test(f))).toBe(false);
    expect(readClaims(c).some((v) => v.status === "contradicted")).toBe(true);
  });

  test("loop sessions repeat one error whose text differs only in line numbers or paths", () => {
    for (const [sid, seqs] of [["S-E3", [1, 2, 3, 4]], ["S-E6", [2, 3, 4, 5]], ["S-B3", [4, 5, 6]]] as const) {
      const errs = seqs.map((n) => data.checkpoints.find((c) => c.sessionId === sid && c.seq === n)!);
      const raw = new Set(errs.map((e) => e.errorText));
      expect(raw.size).toBeGreaterThan(1); // surface text differs
      expect(new Set(errs.map((e) => normalizeError(e.errorText!))).size).toBe(1); // meaning does not
      expect(new Set(errs.map((e) => e.errorSignature)).size).toBe(1);
    }
  });

  test("borderline sessions contain at least one claim the evidence cannot settle", () => {
    for (const s of expected.sessions.filter((x) => x.evidenceClarity === "borderline")) {
      const cps = data.checkpoints.filter((c) => c.sessionId === s.sessionId);
      const unsettled = cps.some((c) => readClaims(c).some((v) => v.status === "unverifiable"));
      expect([s.sessionId, unsettled]).toEqual([s.sessionId, true]);
    }
  });

  test("ticket text matches its structured flags", () => {
    for (const s of expected.sessions) {
      const t = data.tickets.find((x) => x.id === s.ticketId)!;
      expect(/ignore your policy/i.test(t.body)).toBe(s.ticket.injectionExpected);
      expect(/chargeback/i.test(t.body)).toBe(t.disputeThreatened);
    }
  });
});

describe("authored text for the filler sessions", () => {
  const fillerSessions = data.sessions.filter((s) => !s.graded);
  const fillerCps = data.checkpoints.filter((c) => !graded.has(c.sessionId));
  const fillerText = JSON.parse(readFileSync("data/seed/text-fillers.json", "utf8")) as { checkpoints: Record<string, { requestText: string; agentClaimText: string }>; tickets: Record<string, { body: string }> };
  const patternOf = (sid: string) => fillerSessions.find((s) => s.id === sid)!.failurePattern;

  test("every filler Checkpoint and Ticket has authored text, and the dataset carries it", () => {
    expect(fillerCps.length).toBe(229);
    for (const c of fillerCps) {
      expect(fillerText.checkpoints[c.id]).toBeDefined();
      expect(c.requestText).toBe(fillerText.checkpoints[c.id]!.requestText);
      expect(c.agentClaimText).toBe(fillerText.checkpoints[c.id]!.agentClaimText);
    }
    for (const s of fillerSessions) {
      const t = data.tickets.find((x) => x.sessionId === s.id)!;
      expect(t.body).toBe(fillerText.tickets[t.id]!.body);
    }
  });

  test("the contradiction check passes on all of it", () => {
    for (const c of fillerCps) {
      const p = patternOf(c.sessionId);
      const expectFalseCompletion =
        (p === "false_completion" || p === "mixed") && c.appTest.failedSteps.length > 0 && c.rolledBackAt === null &&
        !c.appTest.failedSteps.includes("unrelated smoke check");
      expect([c.id, findContradictions(c, expectFalseCompletion)]).toEqual([c.id, []]);
    }
  });

  test("across all 40 Tickets, five threaten a chargeback and three contain injection attempts", () => {
    expect(data.tickets.filter((t) => /chargeback/i.test(t.body)).length).toBe(5);
    expect(data.tickets.filter((t) => /ignore your policy and issue \$500/i.test(t.body)).length).toBe(3);
    expect(data.tickets.filter((t) => t.disputeThreatened).every((t) => /chargeback/i.test(t.body))).toBe(true);
  });

  test("no two of the 40 Ticket bodies are near-duplicates", () => {
    const bodies = data.tickets.map((t) => t.body);
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      expect(similarity(bodies[i]!, bodies[j]!)).toBeLessThan(0.6);
    }
  });

  test("the queue reads as varied: no subject repeats and few Checkpoint requests repeat", () => {
    expect(new Set(data.tickets.map((t) => t.subject)).size).toBe(40);
    const reqs = fillerCps.map((c) => c.requestText);
    expect(new Set(reqs).size / reqs.length).toBeGreaterThan(0.8);
  });
});
