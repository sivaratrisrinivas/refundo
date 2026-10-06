import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadDatasetFile } from "@/lib/data/seed";
import { BLIND_SESSION_IDS, buildBlindPacket, scoreBlind } from "@/lib/eval/blind";
import { expectedFile } from "./helpers";

const data = loadDatasetFile();
const packet = buildBlindPacket(data);
const json = JSON.stringify(packet);

describe("the simulated blind labeler's inputs", () => {
  test("cover ten Graded sessions and every Checkpoint of each", () => {
    expect(BLIND_SESSION_IDS).toHaveLength(10);
    expect(packet.sessions.map((s) => s.sessionId)).toEqual([...BLIND_SESSION_IDS]);
    for (const s of packet.sessions) {
      expect(s.checkpoints.length).toBe(data.checkpoints.filter((c) => c.sessionId === s.sessionId).length);
    }
  });

  test("provably exclude the expected answers, pipeline output, Failure patterns, Tickets and costs", () => {
    const forbiddenKeys = ["label", "labelSource", "mustCite", "creditCents", "costCents", "plant", "expected", "failurePattern", "amountCents", "status", "subject", "body", "ticket", "decision", "lines", "errorSignature", "orbBlockId"];
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
    };
    walk(packet);
    for (const k of forbiddenKeys) expect(keys.has(k)).toBe(false);
    // no expected Label is written next to a Checkpoint, and no case titles or Failure patterns leak
    for (const e of expectedFile.sessions) {
      expect(json).not.toContain(e.title);
      expect(json).not.toContain(`"${e.caseId}"`);
    }
    for (const p of ["clean_delivered", "reverted_after_fail\"", "failure_pattern", "mixed", "missing_evidence", "free_mode_only"]) expect(json).not.toContain(p);
    // the committed expected file is not part of the packet
    expect(json).not.toContain(readFileSync("eval/expected.json", "utf8").slice(0, 200));
  });

  test("the rubric carries the label set and the original plan's rules, and none of the later design decisions", () => {
    for (const l of ["planning", "delivered", "reverted_after_fail", "loop", "false_completion", "scope_overrun", "incident_overlap", "known_bug", "user_choice_rollback", "unknown"]) {
      expect(packet.rubric).toContain(l);
    }
    expect(packet.rubric).not.toMatch(/precedence|most specific|repeat \d of 3|outside the 30-minute window/i);
  });
});

describe("scoring the blind labels", () => {
  const expected = expectedFile.sessions;
  test("full agreement and disagreement are both counted, and free-mode Checkpoints are skipped", () => {
    const perfect = expected.filter((e) => BLIND_SESSION_IDS.includes(e.sessionId as never)).flatMap((e) =>
      e.checkpoints.filter((c) => !c.excluded).map((c) => ({ checkpointId: `${e.sessionId}-c${c.seq}`, label: c.label! })));
    const full = scoreBlind(perfect, expected);
    expect(full.agreement).toBe(1);
    expect(full.simulated).toBe(true);
    expect(full.kind).toBe("simulated blind labeler");
    const off = scoreBlind(perfect.map((l, i) => (i === 0 ? { ...l, label: "unknown" } : l)), expected);
    expect(off.disagreements).toHaveLength(1);
    expect(off.agreed).toBe(full.checkpoints - 1);
    expect(scoreBlind([], expected).disagreements.length).toBe(full.checkpoints);
  });
});

describe("blind labeler results", () => {
  const score = JSON.parse(readFileSync("eval/blind/agreement.json", "utf8")) as ReturnType<typeof scoreBlind>;
  const labels = (JSON.parse(readFileSync("eval/blind/labels.json", "utf8")) as { labels: { checkpointId: string; label: string }[] }).labels;
  const res = JSON.parse(readFileSync("eval/blind/resolutions.json", "utf8")) as { simulated: boolean; resolutions: { checkpointId: string; resolution: string; rubricRule: number }[] };

  test("the stored agreement is tagged simulated and matches a fresh scoring of the stored labels", () => {
    expect(score.simulated).toBe(true);
    expect(score.kind).toBe("simulated blind labeler");
    expect(scoreBlind(labels, expectedFile.sessions)).toEqual(score);
    expect(score.sessions).toHaveLength(10);
  });

  test("every disagreement is resolved by a rubric fix or marked ambiguous, and the rubric carries the fix", () => {
    expect(res.simulated).toBe(true);
    expect(res.resolutions.map((r) => r.checkpointId).sort()).toEqual(score.disagreements.map((d) => d.checkpointId).sort());
    for (const r of res.resolutions) expect(["rubric_fix", "ambiguous"]).toContain(r.resolution);
    const rubric = readFileSync("docs/rubric.md", "utf8");
    expect(rubric).toMatch(/An error alone does not make a Checkpoint non-delivered/);
    expect(rubric).toMatch(/Unverifiable is not contradicted/);
  });

  test("the expected answers were not changed to match the labeler", () => {
    for (const d of score.disagreements) {
      const e = expectedFile.sessions.flatMap((s) => s.checkpoints.map((c) => ({ id: `${s.sessionId}-c${c.seq}`, label: c.label }))).find((x) => x.id === d.checkpointId)!;
      expect(e.label).toBe(d.expected);
    }
  });
});
