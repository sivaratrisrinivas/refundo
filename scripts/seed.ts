import { clearAll, seedDb } from "@/lib/data/seed";
import { getDb } from "@/lib/db/client";

const db = getDb();
clearAll(db);
seedDb(db);
console.log("seeded", process.env.REFUNDO_DB ?? "data/refundo.db");
