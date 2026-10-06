import { writeFileSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { exportOverrideBacklog } from "@/lib/pipeline/backlog";

const items = exportOverrideBacklog(getDb());
writeFileSync("eval/backlog.json", JSON.stringify(items, null, 2) + "\n");
console.log(`wrote ${items.length} backlog item(s) to eval/backlog.json`);
