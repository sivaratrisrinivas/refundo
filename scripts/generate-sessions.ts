import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateDataset, type ExpectedFile } from "@/lib/data/generate";
import type { TextOverrides } from "@/lib/data/types";

const expected = JSON.parse(readFileSync("eval/expected.json", "utf8")) as ExpectedFile;
const merge = (...files: string[]): TextOverrides => {
  const out: TextOverrides = { checkpoints: {}, tickets: {} };
  for (const f of files) {
    if (!existsSync(f)) continue;
    const t = JSON.parse(readFileSync(f, "utf8")) as TextOverrides;
    Object.assign(out.checkpoints!, t.checkpoints ?? {});
    Object.assign(out.tickets!, t.tickets ?? {});
  }
  return out;
};
const overrides = merge("data/seed/text-graded.json", "data/seed/text-fillers.json");
const dataset = generateDataset(expected, overrides);
mkdirSync("data/seed", { recursive: true });
writeFileSync("data/seed/dataset.json", JSON.stringify(dataset, null, 1) + "\n");
console.log(
  `generated ${dataset.sessions.length} sessions, ${dataset.checkpoints.length} checkpoints, ${dataset.tickets.length} tickets, ${dataset.accounts.length} accounts`,
);
