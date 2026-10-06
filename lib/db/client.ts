import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

const MIGRATIONS = join(process.cwd(), "drizzle");

/** Open a database, apply migrations, return the Drizzle handle. */
export function createDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

/** Fresh in-memory database using the same driver as the app. */
export function createTestDb(): Db {
  return createDb(":memory:");
}

const g = globalThis as unknown as { __refundoDb?: Db };

/** The app's database (one per process). */
export function getDb(): Db {
  if (!g.__refundoDb) {
    g.__refundoDb = createDb(process.env.REFUNDO_DB ?? join(process.cwd(), "data", "refundo.db"));
  }
  return g.__refundoDb;
}

export { schema };
