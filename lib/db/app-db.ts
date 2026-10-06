import { ensureSeeded } from "@/lib/data/seed";
import { getDb, type Db } from "./client";

/** The app's database, seeded on first use. */
export function appDb(): Db {
  const db = getDb();
  ensureSeeded(db);
  return db;
}
