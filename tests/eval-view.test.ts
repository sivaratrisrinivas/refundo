import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEval } from "@/lib/eval/run";
import { latestReports } from "@/lib/eval/report";
import { metricRows, sessionRows } from "@/lib/eval/view";

describe("Eval page data", () => {
  test("with no stored report there is nothing to show, not placeholder numbers", () => {
    const empty = latestReports(mkdtempSync(join(tmpdir(), "refundo-empty-")));
    expect(empty).toEqual({});
    expect(sessionRows(empty)).toEqual([]);
    expect(metricRows(empty).every((r) => Object.keys(r.cells).length === 0)).toBe(true);
  });

  test("each headline metric appears for both models, with misses marked, from the stored reports", async () => {
    const a = await runEval({ model: "sim-a" });
    const b = await runEval({ model: "sim-b" });
    const rows = metricRows({ "sim-a": a, "sim-b": b });
    expect(rows.map((r) => r.key)).toEqual(["labelAgreement", "exactCreditMatch", "uncited", "injection", "cost", "latency", "mock", "reply"]);
    for (const r of rows) expect(Object.keys(r.cells).sort()).toEqual(["sim-a", "sim-b"]);
    const agreement = rows.find((r) => r.key === "labelAgreement")!;
    expect(agreement.cells["sim-a"]!.text).toContain(`${(a.metrics.labelAgreement.value! * 100).toFixed(1)}%`);
    expect(agreement.cells["sim-b"]!.status).toBe("missed"); // model B is below 85%
    expect(rows.find((r) => r.key === "cost")!.cells["sim-a"]!.status).toBe("reported");
    expect(rows.find((r) => r.key === "uncited")!.cells["sim-b"]!.status).toBe("met");
  });

  test("a failing session carries expected versus actual per Checkpoint for both models", async () => {
    const a = await runEval({ model: "sim-a" });
    const b = await runEval({ model: "sim-b" });
    const rows = sessionRows({ "sim-a": a, "sim-b": b });
    expect(rows).toHaveLength(20);
    const failing = rows.find((r) => r.results["sim-b"] && !r.results["sim-b"]!.pass)!;
    const res = failing.results["sim-b"]!;
    expect(res.checkpoints.length).toBeGreaterThan(0);
    expect(res.checkpoints.some((c) => !c.ok)).toBe(true);
    for (const c of res.checkpoints) expect(c).toHaveProperty("expectedLabel");
  });
});
