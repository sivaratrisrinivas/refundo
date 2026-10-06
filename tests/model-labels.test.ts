import { describe, expect, test } from "bun:test";
import { errorFreeModel, getProvider, type CallContext, type ModelProvider, type ModelResult, type Task, type TaskInputs } from "@/lib/models";
import { runCase } from "@/lib/pipeline/run";
import { loadDecision, saveDecision } from "@/lib/pipeline/store";
import { cpId, GRADED, seededDb, type ExpectedSession } from "./helpers";
import { VALID_EVIDENCE } from "@/lib/models";

const perfect = errorFreeModel("sim-a");
const caseOf = (id: string) => GRADED.find((s) => s.caseId === id)!;
const labelFor = (d: Awaited<ReturnType<typeof runCase>>, s: ExpectedSession, seq: number) => d.labels.find((l) => l.checkpointId === cpId(s, seq));

/** A provider that wraps a real one and lets a test rewrite its raw output. */
class Scripted implements ModelProvider {
  readonly name = "sim-a" as const;
  readonly displayName = "scripted";
  calls: { task: Task; input: unknown; attempt: number }[] = [];
  constructor(private inner: ModelProvider, private rewrite: (task: Task, out: unknown, attempt: number) => unknown) {}
  async call<T extends Task>(task: T, input: TaskInputs[T], ctx: CallContext): Promise<ModelResult> {
    const r = await this.inner.call(task, input, ctx);
    this.calls.push({ task, input, attempt: ctx.attempt ?? 0 });
    return { ...r, output: this.rewrite(task, r.output, ctx.attempt ?? 0) };
  }
}

describe("model-judged Checkpoints (error-free model)", () => {
  test("the false-completion Graded session is labeled false_completion and cites both required fields", async () => {
    const db = seededDb();
    const s = caseOf("E4");
    const d = await runCase(db, s.ticketId, { provider: perfect });
    const l = labelFor(d, s, 3)!;
    expect(l.label).toBe("false_completion");
    expect(l.source).toBe("model");
    expect(l.evidenceFields).toEqual(expect.arrayContaining(["agentClaimText", "appTest"]));
    expect(d.amountCents).toBe(s.expected.amountCents);
  });

  test("a clean delivered session stays delivered at 0 Credit", async () => {
    const db = seededDb();
    const s = caseOf("E1");
    const d = await runCase(db, s.ticketId, { provider: perfect });
    expect(d.labels.every((l) => l.label === "delivered")).toBe(true);
    expect(d.amountCents).toBe(0);
    expect(d.status).toBe("ready");
    expect(d.unresolved).toEqual([]);
  });

  test("the Checkpoint with missing diff and test data is unknown, with no Credit and a human prompt", async () => {
    const db = seededDb();
    const s = caseOf("E15");
    const d = await runCase(db, s.ticketId, { provider: perfect });
    const l = labelFor(d, s, 3)!;
    expect(l.label).toBe("unknown");
    expect(l.humanPrompt).toBeTruthy();
    expect(d.lines.find((x) => x.checkpointId === cpId(s, 3))!.creditCents).toBe(0);
    expect(d.status).toBe("needs_human");
  });

  test("every Graded session prices exactly as expected, and model Labels match, with the error-free model", async () => {
    const db = seededDb();
    for (const s of GRADED) {
      const d = await runCase(db, s.ticketId, { provider: perfect });
      expect([s.caseId, d.amountCents]).toEqual([s.caseId, s.expected.amountCents]);
      expect([s.caseId, d.status]).toEqual([s.caseId, s.expected.status as never]);
      for (const e of s.checkpoints.filter((x) => !x.excluded)) {
        const l = labelFor(d, s, e.seq);
        expect([s.caseId, e.seq, l?.label]).toEqual([s.caseId, e.seq, e.label as never]);
      }
    }
  });

  test("rules are applied before the model sees a Checkpoint", async () => {
    const db = seededDb();
    const spy = new Scripted(perfect, (_t, out) => out);
    const s = caseOf("E6");
    await runCase(db, s.ticketId, { provider: spy });
    const seen = new Set<string>(
      spy.calls.filter((c) => c.task === "label").flatMap((c) => (c.input as { checkpoints: { id: string }[] }).checkpoints.map((k) => k.id)),
    );
    const ruleIds = s.checkpoints.filter((e) => e.labelSource === "rule").map((e) => cpId(s, e.seq));
    expect(ruleIds.length).toBeGreaterThan(0);
    for (const id of ruleIds) expect(seen.has(id)).toBe(false);
    expect(seen.size).toBe(s.checkpoints.filter((e) => e.labelSource === "model").length);
  });

  test("a human Override beats a model Label", async () => {
    const db = seededDb();
    const s = caseOf("E4");
    const d = await runCase(db, s.ticketId, { provider: perfect });
    saveDecision(db, { ...d, overrides: [{ kind: "label", checkpointId: cpId(s, 3), from: "false_completion", to: "delivered", reason: "login test was flaky", actor: "specialist", ts: "t" }] });
    const after = await runCase(db, s.ticketId, { provider: perfect });
    expect(labelFor(after, s, 3)!.source).toBe("human");
    expect(after.amountCents).toBe(0);
  });
});

describe("citation validator and schema retry", () => {
  test("a model that cites a missing field yields unknown, never a rendered uncited Label", async () => {
    const db = seededDb();
    const bad = new Scripted(perfect, (task, out) =>
      task === "label" ? (out as { evidenceFields: string[] }[]).map((l) => ({ ...l, evidenceFields: ["stackTrace"] })) : out);
    const s = caseOf("E4");
    const d = await runCase(db, s.ticketId, { provider: bad });
    const l = labelFor(d, s, 3)!;
    expect(l.label).toBe("unknown");
    expect(l.humanPrompt).toBeTruthy();
    expect(d.lines.find((x) => x.checkpointId === cpId(s, 3))!.creditCents).toBe(0);
    for (const x of d.labels.filter((y) => y.source === "model" && y.label !== "unknown")) {
      expect(x.evidenceFields.length).toBeGreaterThan(0);
    }
  });

  test("a Label with no citation is unknown", async () => {
    const db = seededDb();
    const bad = new Scripted(perfect, (task, out) => (task === "label" ? (out as object[]).map((l) => ({ ...l, evidenceFields: [] })) : out));
    const d = await runCase(db, caseOf("E4").ticketId, { provider: bad });
    expect(d.labels.filter((l) => l.source === "model").every((l) => l.label === "unknown")).toBe(true);
  });

  test("confidence under 0.6 becomes unknown with a human prompt", async () => {
    const db = seededDb();
    const bad = new Scripted(perfect, (task, out) => (task === "label" ? (out as object[]).map((l) => ({ ...l, confidence: 0.59 })) : out));
    const d = await runCase(db, caseOf("E4").ticketId, { provider: bad });
    const l = labelFor(d, caseOf("E4"), 3)!;
    expect([l.label, !!l.humanPrompt]).toEqual(["unknown", true]);
  });

  test("a false_completion Label with no contradicted claim is not credited", async () => {
    const db = seededDb();
    const bad = new Scripted(perfect, (task, out) => (task === "label" ? (out as { label: string }[]).map((l) => ({ ...l, label: "false_completion" })) : out));
    const s = caseOf("E1");
    const d = await runCase(db, s.ticketId, { provider: bad });
    expect(d.amountCents).toBe(0);
    expect(d.labels.filter((l) => l.source === "model").every((l) => l.label === "unknown")).toBe(true);
  });

  test("a schema violation retries once and then succeeds", async () => {
    const db = seededDb();
    const flaky = new Scripted(perfect, (task, out, attempt) => (task === "label" && attempt === 0 ? { labels: out } : out));
    const d = await runCase(db, caseOf("E4").ticketId, { provider: flaky });
    const step = d.trace.find((t) => t.step === "label")!;
    expect([step.ok, step.attempts]).toEqual([true, 2]);
    expect(d.status).not.toBe("needs_human");
  });

  test("two schema violations route the Case to needs_human", async () => {
    const db = seededDb();
    const broken = new Scripted(perfect, (task, out) => (task === "label" ? { labels: out } : out));
    const d = await runCase(db, caseOf("E4").ticketId, { provider: broken });
    expect(d.trace.find((t) => t.step === "label")!.ok).toBe(false);
    expect(d.status).toBe("needs_human");
    expect(d.unresolved.length).toBeGreaterThan(0);
    expect(d.notes.join(" ")).toMatch(/Labeler/);
  });

  test("a verify-step failure also routes to needs_human", async () => {
    const db = seededDb();
    const broken = new Scripted(perfect, (task, out) => (task === "verify" ? { claims: out } : out));
    const d = await runCase(db, caseOf("E4").ticketId, { provider: broken });
    expect(d.status).toBe("needs_human");
  });

  test("the model name and prompt version are stored on the Decision", async () => {
    const db = seededDb();
    await runCase(db, caseOf("E1").ticketId, { provider: getProvider("sim-b") });
    const d = loadDecision(db, caseOf("E1").ticketId)!;
    expect(d.modelName).toBe("sim-b");
    expect(d.promptVersion).toMatch(/^refundo-prompts-/);
    expect(d.costUsd).toBeGreaterThan(0);
    expect(d.latencyMs).toBeGreaterThan(0);
  });
});

describe("model B changes outputs only in the ways its error profile allows", () => {
  const SEEDS = Array.from({ length: 25 }, (_, i) => `seed-${i}`);

  for (const name of ["sim-a", "sim-b"] as const) {
    test(`${name}: over ${SEEDS.length} seeds x 20 sessions, no uncited Label reaches a Decision, and money only comes from rules, supported false completions or humans`, async () => {
      const provider = getProvider(name);
      const valid = new Set<string>(VALID_EVIDENCE.filter((f) => f !== "incident" && f !== "bug_signature"));
      for (const seed of SEEDS) {
        const db = seededDb();
        for (const s of GRADED) {
          const d = await runCase(db, s.ticketId, { provider, seed });
          for (const l of d.labels) {
            if (l.source === "model" && l.label !== "unknown") {
              expect(l.evidenceFields.length).toBeGreaterThan(0);
              for (const f of l.evidenceFields) expect(valid.has(f)).toBe(true);
              expect(l.confidence).toBeGreaterThanOrEqual(0.6);
            }
          }
          for (const line of d.lines.filter((x) => x.creditCents > 0 && x.source === "model")) {
            expect(line.label).toBe("false_completion");
          }
          // a model never moves a rule-settled Checkpoint
          for (const e of s.checkpoints.filter((x) => x.labelSource === "rule")) {
            expect(labelFor(d, s, e.seq)!.label).toBe(e.label as never);
          }
        }
      }
    });
  }

  test("same inputs and seed give the identical Decision", async () => {
    const a = await runCase(seededDb(), "T-E6", { provider: getProvider("sim-b"), seed: "x" });
    const b = await runCase(seededDb(), "T-E6", { provider: getProvider("sim-b"), seed: "x" });
    expect(b).toEqual(a);
  });

  test("an error-free copy of model B is identical to model A's error-free output (only the profile differs)", async () => {
    const a = await runCase(seededDb(), "T-E6", { provider: errorFreeModel("sim-a"), seed: "x" });
    const b = await runCase(seededDb(), "T-E6", { provider: errorFreeModel("sim-b"), seed: "x" });
    expect(b.labels).toEqual(a.labels);
    expect(b.amountCents).toBe(a.amountCents);
    expect(b.costUsd).toBeLessThan(a.costUsd);
  });
});

