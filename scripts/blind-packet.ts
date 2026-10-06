import { writeFileSync } from "node:fs";
import { loadDatasetFile } from "@/lib/data/seed";
import { buildBlindPacket } from "@/lib/eval/blind";

writeFileSync("eval/blind/packet.json", JSON.stringify(buildBlindPacket(loadDatasetFile()), null, 1) + "\n");
console.log("wrote eval/blind/packet.json");
