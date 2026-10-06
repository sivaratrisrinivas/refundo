import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { latestReports } from "@/lib/eval/report";

describe("demo walkthrough", () => {
  const script = readFileSync("docs/demo/script.md", "utf8");

  test("the recording exists and its captioned script says it is under three minutes", () => {
    expect(existsSync("docs/demo/walkthrough.webm")).toBe(true);
    expect(statSync("docs/demo/walkthrough.webm").size).toBeGreaterThan(100_000);
    const m = script.match(/about (\d+):(\d{2})\)/)!;
    expect(Number(m[1]) * 60 + Number(m[2])).toBeLessThan(180);
  });

  test("the script covers queue, Case, evidence drawer, Approval, Systems and Eval, silently", () => {
    for (const term of ["Queue", "mixed Session", "evidence drawer", "Approve once", "Systems page", "Eval", "refused by the server"]) expect(script).toContain(term);
    expect(script).toMatch(/no narration/i);
    expect(script).toMatch(/banner .All data is synthetic. is visible throughout/);
    expect((script.match(/^\| \d+:\d{2} \|/gm) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  test("every metric shown is read from the stored reports", () => {
    const r = latestReports();
    const a = `${(r["sim-a"]!.metrics.labelAgreement.value! * 100).toFixed(1)}%`;
    const b = `${(r["sim-b"]!.metrics.labelAgreement.value! * 100).toFixed(1)}%`;
    expect(script).toContain(`label agreement ${a} on model A and ${b} on model B`);
  });
});
