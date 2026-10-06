import { readFileSync, writeFileSync } from "node:fs";
import { scoreBlind, type BlindLabel } from "@/lib/eval/blind";
import { loadExpected } from "@/lib/eval/run";

const labels = (JSON.parse(readFileSync("eval/blind/labels.json", "utf8")) as { labels: BlindLabel[] }).labels;
const score = scoreBlind(labels, loadExpected().sessions);
writeFileSync("eval/blind/agreement.json", JSON.stringify(score, null, 2) + "\n");
console.log(`simulated blind labeler: ${score.agreed}/${score.checkpoints} = ${(score.agreement * 100).toFixed(1)}%`);
for (const d of score.disagreements) console.log(`  ${d.checkpointId}: expected ${d.expected}, blind ${d.blind}${d.note ? ` (${d.note})` : ""}`);
