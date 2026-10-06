import { readFileSync } from "node:fs";
import { loadDatasetFile, seedDb } from "@/lib/data/seed";
import { createTestDb, type Db } from "@/lib/db/client";

export interface ExpectedCp {
  seq: number; mode: "free" | "power" | "max"; costCents: number; excluded: boolean; label: string | null;
  labelSource: "rule" | "model" | null; mustCite: string[]; creditCents: number; plant: Record<string, unknown>;
}
export interface ExpectedSession {
  caseId: string; sessionId: string; ticketId: string; title: string;
  account: { plan: string; creditsGranted30dCents: number };
  ticket: { disputeThreatened: boolean; injectionExpected: boolean };
  priorCredit: { amountCents: number; approvedOn: string } | null;
  checkpoints: ExpectedCp[];
  expected: {
    subtotalCents: number; amountCents: number; status: string; capStatus: string; clauses: string[];
    routeTo: string | null; linearIssue: boolean; injectionDetected: boolean; humanPrompt: boolean;
    duplicateOfCredited: boolean; ceilingCents: number | null;
  };
}
export const expectedFile = JSON.parse(readFileSync("eval/expected.json", "utf8")) as { sessions: ExpectedSession[]; targets: Record<string, number | string> };
export const GRADED = expectedFile.sessions;

const dataset = loadDatasetFile();

/** A fresh in-memory database seeded with the committed dataset. */
export function seededDb(): Db {
  const db = createTestDb();
  seedDb(db, dataset);
  return db;
}

export const cpId = (s: ExpectedSession, seq: number) => `${s.sessionId}-c${seq}`;
