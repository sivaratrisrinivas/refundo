import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { latestReports } from "@/lib/eval/report";
import { RESULTS_END, RESULTS_START, renderResults } from "@/lib/eval/render";

const md = readFileSync("README.md", "utf8");
const outside = md.slice(0, md.indexOf(RESULTS_START)) + md.slice(md.indexOf(RESULTS_END) + RESULTS_END.length);

describe("README", () => {
  test("its results block is exactly what the stored reports render to", () => {
    const inner = md.slice(md.indexOf(RESULTS_START) + RESULTS_START.length, md.indexOf(RESULTS_END)).trim();
    expect(inner).toBe(renderResults(latestReports()).trim());
  });

  test("no eval figure is typed into the README outside the generated block", () => {
    expect(outside.match(/\b\d+(?:\.\d+)?\s?%/g) ?? []).toEqual([]);
    expect(outside).not.toMatch(/p50|\bseed `/);
  });

  test("the built-versus-faked table lists every Mock system, Simulated model and simulated human task", () => {
    const table = md.slice(md.indexOf("## Built versus faked"), md.indexOf("## Eval results"));
    for (const term of ["Orb ledger, Zendesk, Linear", "Mock systems", "Simulated models", "Blind labeler, annotator", "Demo walkthrough", "Faked", "Built"]) expect(table).toContain(term);
    expect(table).toMatch(/not a measurement|No LLM is called/);
  });

  test("states the headline plainly, the demo-grade auth note and the Replit caveats", () => {
    expect(md).toMatch(/not\*\* a measurement of any real model/);
    expect(md).toMatch(/Demo-grade auth/);
    expect(md).toMatch(/Reserved VM/);
    expect(md).toMatch(/seeds on boot/);
    expect(md).toMatch(/No uptime pingers/);
    expect(md).toMatch(/secrets/);
    expect(md).toMatch(/drafts the owning company would set|draft numbers/);
  });

  test("the ROI calculator inputs are blank placeholders and the out-of-scope list is present", () => {
    const roi = md.slice(md.indexOf("## ROI calculator"), md.indexOf("## Production path"));
    expect((roi.match(/\| \[X\] \|/g) ?? []).length).toBe(8);
    for (const term of ["chargeback fight-or-refund desk", "real llm calls", "cash refunds"]) expect(md.toLowerCase()).toContain(term);
  });

  test("the production path has its three steps", () => {
    for (const term of ["Shadow mode on closed Tickets", "Approval on every write", "Policy owned by Support and Finance"]) expect(md).toContain(term);
  });
});
