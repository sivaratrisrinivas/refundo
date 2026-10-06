import { describe, expect, test } from "bun:test";
import { errorFreeModel, getProvider, type CallContext, type ModelProvider, type ModelResult, type ReplyDecision, type Task, type TaskInputs } from "@/lib/models";
import { assembleCase } from "@/lib/pipeline/assemble";
import { editReply } from "@/lib/pipeline/decide";
import { buildReplyDecision, validateReply } from "@/lib/pipeline/reply";
import { buildLabeledReplySet } from "@/lib/pipeline/reply-validator-set";
import { runCase } from "@/lib/pipeline/run";
import { loadDecision } from "@/lib/pipeline/store";
import { usd } from "@/lib/models/reply-template";
import { GRADED, seededDb } from "./helpers";

const perfect = errorFreeModel("sim-a");

async function graded(provider: ModelProvider = perfect, seed?: string) {
  const db = seededDb();
  const out: { s: (typeof GRADED)[number]; d: Awaited<ReturnType<typeof runCase>>; rd: ReplyDecision }[] = [];
  for (const s of GRADED) {
    const d = await runCase(db, s.ticketId, { provider, seed });
    out.push({ s, d, rd: buildReplyDecision(assembleCase(db, s.ticketId)!, d) });
  }
  return { db, out };
}

describe("replies for the Graded sessions", () => {
  test("every Graded session with a Credit has a reply with every Credit line and no other number", async () => {
    const { out } = await graded();
    const credited = out.filter(({ d }) => d.amountCents > 0 && !d.priorCredit);
    expect(credited.length).toBeGreaterThan(8);
    for (const { s, d, rd } of credited) {
      expect(d.reply).not.toBeNull();
      for (const l of d.lines.filter((x) => x.creditCents > 0)) {
        expect(d.reply!).toContain(`Checkpoint ${l.seq}`);
        expect(d.reply!).toContain(usd(l.creditCents));
      }
      expect([s.caseId, validateReply(d.reply!, rd).ok]).toEqual([s.caseId, true]);
      // every dollar figure is one the Decision contains
      const allowed = new Set([usd(d.amountCents), usd(d.subtotalCents), ...d.lines.map((l) => usd(l.creditCents))]);
      for (const m of d.reply!.match(/\$[\d,]+\.\d{2}/g) ?? []) expect(allowed.has(m)).toBe(true);
      expect(d.reply!.split(/\s+/).length).toBeLessThan(180);
    }
  });

  test("the planning session's reply explains Plan Mode billing at $0", async () => {
    const { out } = await graded();
    const e10 = out.find((x) => x.s.caseId === "E10")!;
    expect(e10.d.amountCents).toBe(0);
    expect(e10.d.reply).toMatch(/Plan Mode is billed/);
  });

  test("the duplicate Ticket's reply references the earlier Credit", async () => {
    const { out } = await graded();
    const e16 = out.find((x) => x.s.caseId === "E16")!;
    expect(e16.d.reply).toContain("$15.00");
    expect(e16.d.reply).toMatch(/already credited/);
    expect(e16.d.reply).toContain("2026-09-30");
  });

  test("the Enterprise reply is a recommendation routed to the account manager", async () => {
    const { out } = await graded();
    const e13 = out.find((x) => x.s.caseId === "E13")!;
    expect(e13.d.reply).toMatch(/account manager/);
    expect(e13.d.reply).toMatch(/Total recommended credit/);
  });

  test("replies mention one concrete tip", async () => {
    const { out } = await graded();
    for (const { d } of out) expect((d.reply!.match(/^Tip:/gm) ?? []).length).toBe(1);
  });
});

describe("no cash promise or fault admission survives validation, on either Simulated model", () => {
  for (const name of ["sim-a", "sim-b"] as const) {
    test(`${name} over 30 seeds`, async () => {
      for (let i = 0; i < 30; i++) {
        const { out } = await graded(getProvider(name), `r-${i}`);
        for (const { d, rd } of out) {
          if (d.reply === null) {
            expect(d.status === "needs_human" || d.status === "recommend_only").toBe(true);
            continue;
          }
          expect(d.reply).not.toMatch(/refund|cash|our fault|never happen again|\bto your card\b/i);
          expect(validateReply(d.reply, rd).ok).toBe(true);
        }
      }
    });
  }

  test("a model that always injects a defect never gets a draft past the validator", async () => {
    class Always implements ModelProvider {
      readonly name = "sim-b" as const; readonly displayName = "always-bad";
      async call<T extends Task>(task: T, input: TaskInputs[T], ctx: CallContext): Promise<ModelResult> {
        const r = await perfect.call(task, input, ctx);
        return task === "reply" ? { ...r, output: `${r.output as string}\n\nI've also issued a refund of $9.99 to your card.` } : r;
      }
    }
    const db = seededDb();
    const d = await runCase(db, "T-E2", { provider: new Always() });
    expect(d.reply).toBeNull();
    expect(d.status).toBe("needs_human");
    expect(loadDecision(db, "T-E2")!.reply).toBeNull();
    expect(d.trace.find((t) => t.step === "draft reply")!.attempts).toBe(3);
  });
});

describe("the validator against a labeled set of good and bad replies", () => {
  test("reports true positive and true negative rates, and every defect model B can inject is in the bad set", async () => {
    const { out } = await graded();
    const set = buildLabeledReplySet(out.map((x) => x.rd));
    const bad = set.filter((x) => x.label === "bad");
    const good = set.filter((x) => x.label === "good");
    expect(good.length).toBeGreaterThan(60);
    expect(bad.length).toBeGreaterThan(100);

    const rejectedBad = bad.filter((x) => !validateReply(x.text, x.decision).ok);
    const acceptedGood = good.filter((x) => validateReply(x.text, x.decision).ok);
    const tpr = rejectedBad.length / bad.length;
    const tnr = acceptedGood.length / good.length;
    expect([tpr, tnr]).toEqual([1, 1]);

    // a bad reply is rejected for the reason it is bad
    for (const x of bad) {
      expect(validateReply(x.text, x.decision).violations.map((v) => v.kind)).toContain(x.defect!);
    }
    const injected = new Set(bad.filter((x) => x.injectedByModelB).map((x) => x.defect));
    expect([...injected].sort()).toEqual(["cash_language", "extra_number", "fault_admission", "missing_line"]);
  });
});

describe("editing the reply", () => {
  test("a valid edit is stored and survives a re-run; an invalid edit is refused", async () => {
    const db = seededDb();
    const d = await runCase(db, "T-E2", { provider: perfect });
    const ok = editReply(db, "T-E2", d.reply!.replace("Best,", "Happy to clarify anything.\n\nBest,"), "specialist", "t");
    expect(ok.ok).toBe(true);
    expect(loadDecision(db, "T-E2")!.reply).toContain("Happy to clarify anything.");
    const again = await runCase(db, "T-E2", { provider: perfect });
    expect(again.reply).toContain("Happy to clarify anything.");

    const bad = editReply(db, "T-E2", d.reply!.replace("Best,", "We will refund you in cash.\n\nBest,"), "specialist", "t");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.violations.map((v) => v.kind)).toContain("cash_language");
    expect(loadDecision(db, "T-E2")!.reply).toContain("Happy to clarify anything.");
  });

  test("an edit that no longer matches a re-priced Decision is replaced by a fresh validated draft", async () => {
    const db = seededDb();
    const d = await runCase(db, "T-E2", { provider: perfect });
    editReply(db, "T-E2", d.reply!.replace("Best,", "Thanks again.\n\nBest,"), "specialist", "t");
    const cur = loadDecision(db, "T-E2")!;
    const lineSeq = cur.lines.find((l) => l.creditCents > 0)!.checkpointId;
    // A Label Override changes the amount, so the old edit's figures are stale.
    const { saveDecision } = await import("@/lib/pipeline/store");
    saveDecision(db, { ...cur, overrides: [...cur.overrides, { kind: "label", checkpointId: lineSeq, from: "reverted_after_fail", to: "delivered", reason: "tests were flaky", actor: "specialist", ts: "t" }] });
    const after = await runCase(db, "T-E2", { provider: perfect });
    expect(after.amountCents).toBe(0);
    expect(after.reply).not.toContain("Thanks again.");
  });
});
