import type { Dataset } from "@/lib/data/types";

/**
 * The simulated blind labeler (a separate subagent, never a human) receives only
 * this packet: the rubric as written in the original plan and the raw Checkpoints.
 * It never sees expected answers, pipeline output, Failure patterns, Tickets or costs.
 * Its agreement is reported as "simulated blind labeler", never as human inter-rater agreement.
 */

/** Ten of the twenty Graded sessions, chosen to cover every rule-decided Label and both boundaries. */
export const BLIND_SESSION_IDS = ["S-E2", "S-E3", "S-E4", "S-E5", "S-E7", "S-E8", "S-E9", "S-E10", "S-E15", "S-B1"] as const;

/** The rubric as the original plan wrote it (labels, criteria, the 30-minute window, the median table). Nothing from later design decisions. */
export const BLIND_RUBRIC = `You label each Checkpoint of an AI app-builder Session with exactly ONE Label from this fixed set. Judge only from the Checkpoint data you are given.

LABELS AND CRITERIA
- planning: a Plan Mode Checkpoint, no files changed, and the agent's claim describes a plan.
- delivered: the agent's claims are verified against the changed files and test results, and there was no rollback within 30 minutes.
- reverted_after_fail: the app test failed (appTest.passed = false) and the Checkpoint was rolled back (rolledBackAt) within 30 minutes of its ts.
- loop: the same normalized error signature appears on 3 or more consecutive Checkpoints; label from the 3rd onward. (Normalize an error by: lowercase, strip file paths, line and column numbers, hex addresses, UUIDs and timestamps.)
- false_completion: a claim in the agent's completion message is contradicted: a failed test step covers it, or no changed file plausibly implements it.
- scope_overrun: the number of changed files is at least 10 times the median for that request type. Request types and medians: style 3, fix 4, feature 8, refactor 12.
- incident_overlap: the Checkpoint's ts is inside a public incident window (listed in the packet) and the Checkpoint errored.
- known_bug: the changed file list or the error text matches a bug signature (listed in the packet).
- user_choice_rollback: the Checkpoint was rolled back with no failure signal (tests passed or were not run, and there was no error).
- unknown: the diff and test data are missing, or you cannot decide from the evidence.

CITING EVIDENCE
For every Label except unknown, list the Checkpoint fields that support it. Use ONLY these field names: ts, mode, requestText, agentClaimText, filesChanged, linesAdded, linesRemoved, appTest, rolledBackAt, errorText, planMode, incident, bug_signature.

Free-mode Checkpoints (mode "free") are excluded from credit: do not label them.

ANSWER FORMAT
Return one JSON object: {"labels": [{"checkpointId": "...", "label": "...", "evidenceFields": ["..."], "confidence": 0.0-1.0, "note": "optional, one short sentence if the rubric was unclear"}]} with one entry per labelable Checkpoint. Return JSON only.`;

export interface BlindPacket {
  rubric: string;
  incidents: { id: string; title: string; startsAt: string; endsAt: string }[];
  bugSignatures: { id: string; name: string; pattern: string }[];
  sessions: {
    sessionId: string;
    checkpoints: {
      id: string; seq: number; ts: string; mode: string; planMode: boolean; requestText: string; agentClaimText: string;
      filesChanged: string[]; linesAdded: number; linesRemoved: number;
      appTest: { ran: boolean; passed: boolean | null; failedSteps: string[] }; rolledBackAt: string | null; errorText: string | null;
    }[];
  }[];
}

export function buildBlindPacket(data: Dataset, ids: readonly string[] = BLIND_SESSION_IDS): BlindPacket {
  return {
    rubric: BLIND_RUBRIC,
    incidents: data.incidents.map((i) => ({ id: i.id, title: i.title, startsAt: i.startsAt, endsAt: i.endsAt })),
    bugSignatures: data.bugSignatures.map((b) => ({ id: b.id, name: b.name, pattern: b.pattern })),
    sessions: ids.map((sid) => ({
      sessionId: sid,
      checkpoints: data.checkpoints
        .filter((c) => c.sessionId === sid)
        .sort((a, b) => a.seq - b.seq)
        .map((c) => ({
          id: c.id, seq: c.seq, ts: c.ts, mode: c.mode, planMode: c.planMode, requestText: c.requestText, agentClaimText: c.agentClaimText,
          filesChanged: c.filesChanged, linesAdded: c.linesAdded, linesRemoved: c.linesRemoved, appTest: c.appTest,
          rolledBackAt: c.rolledBackAt, errorText: c.errorText,
        })),
    })),
  };
}

export interface BlindLabel { checkpointId: string; label: string; evidenceFields?: string[]; confidence?: number; note?: string }

export interface BlindScore {
  simulated: true;
  kind: "simulated blind labeler";
  sessions: string[];
  checkpoints: number;
  agreed: number;
  agreement: number;
  disagreements: { checkpointId: string; expected: string; blind: string; note?: string }[];
}

/** Compare the blind labels with the committed expected Labels. Free-mode Checkpoints are skipped. */
export function scoreBlind(
  labels: BlindLabel[],
  expected: { sessionId: string; checkpoints: { seq: number; excluded: boolean; label: string | null }[] }[],
  ids: readonly string[] = BLIND_SESSION_IDS,
): BlindScore {
  const byId = new Map(labels.map((l) => [l.checkpointId, l]));
  const disagreements: BlindScore["disagreements"] = [];
  let n = 0, agreed = 0;
  for (const s of expected.filter((e) => ids.includes(e.sessionId))) {
    for (const c of s.checkpoints.filter((x) => !x.excluded)) {
      n++;
      const id = `${s.sessionId}-c${c.seq}`;
      const got = byId.get(id);
      if (got?.label === c.label) agreed++;
      else disagreements.push({ checkpointId: id, expected: c.label ?? "none", blind: got?.label ?? "missing", note: got?.note });
    }
  }
  return { simulated: true, kind: "simulated blind labeler", sessions: [...ids], checkpoints: n, agreed, agreement: n ? agreed / n : 0, disagreements };
}
