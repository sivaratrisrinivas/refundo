import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { latestReports } from "@/lib/eval/report";
import { RESULTS_END, RESULTS_START, renderResults } from "@/lib/eval/render";

// Writes docs/eval/results.md and refreshes the results block of the README, both from the stored reports.
const block = renderResults(latestReports());
writeFileSync("docs/eval/results.md", `# Latest eval results\n\nGenerated from \`eval/reports/\` by \`bun run results\`. Do not edit by hand.\n\n${block}\n`);
if (existsSync("README.md")) {
  const md = readFileSync("README.md", "utf8");
  if (md.includes(RESULTS_START) && md.includes(RESULTS_END)) {
    const i = md.indexOf(RESULTS_START) + RESULTS_START.length;
    const j = md.indexOf(RESULTS_END);
    writeFileSync("README.md", `${md.slice(0, i)}\n${block}\n${md.slice(j)}`);
  }
}
console.log("results rendered");
