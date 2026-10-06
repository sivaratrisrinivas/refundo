import { VALID_EVIDENCE } from "@/lib/models";
import type { Checkpoint } from "@/lib/policy/types";
import type { LabelRecord } from "./types";

// --- Ticket highlighting -----------------------------------------------------

export interface Segment { text: string; hit: boolean }

/** Split the Ticket body so each extracted grievance can be highlighted in place. */
export function highlightSegments(body: string, grievances: { text: string }[]): Segment[] {
  const spans: [number, number][] = [];
  for (const g of grievances) {
    const i = body.indexOf(g.text);
    if (i >= 0 && g.text.length > 0) spans.push([i, i + g.text.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const out: Segment[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: body.slice(pos, a), hit: false });
    out.push({ text: body.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < body.length) out.push({ text: body.slice(pos), hit: false });
  return out.length ? out : [{ text: body, hit: false }];
}

// --- Evidence drawer ---------------------------------------------------------

export interface EvidenceRow { field: string; label: string; value: string; cited: boolean }

const FIELD_LABEL: [keyof Checkpoint, string][] = [
  ["requestText", "Request"], ["agentClaimText", "Agent claim"], ["filesChanged", "Files changed"],
  ["linesAdded", "Lines added"], ["linesRemoved", "Lines removed"], ["appTest", "App test"],
  ["rolledBackAt", "Rolled back at"], ["errorText", "Error"], ["errorSignature", "Error signature"],
  ["ts", "Time"], ["mode", "Mode"], ["planMode", "Plan Mode"], ["costCents", "Cost"],
];

function show(c: Checkpoint, f: keyof Checkpoint): string {
  const v = c[f];
  if (f === "filesChanged") {
    const files = v as string[];
    return files.length === 0 ? "none" : files.length > 6 ? `${files.length} files (${files.slice(0, 3).join(", ")}, …)` : files.join(", ");
  }
  if (f === "appTest") {
    const t = v as Checkpoint["appTest"];
    return !t.ran ? "not run" : t.passed ? "passed" : `failed: ${t.failedSteps.join("; ") || "unspecified step"}`;
  }
  if (f === "costCents") return `$${((v as number) / 100).toFixed(2)}`;
  if (v === null || v === "") return "none";
  return String(v);
}

/** Every field of a Checkpoint, with exactly the cited ones marked. Pseudo-fields (incident, bug_signature) are added when cited. */
export function buildEvidenceView(
  c: Checkpoint, cited: readonly string[], extras: { incident?: string; bug?: string } = {},
): EvidenceRow[] {
  const set = new Set(cited);
  const rows: EvidenceRow[] = FIELD_LABEL.map(([f, label]) => ({ field: f, label, value: show(c, f), cited: set.has(f) }));
  if (set.has("incident")) rows.push({ field: "incident", label: "Public incident", value: extras.incident ?? "matched", cited: true });
  if (set.has("bug_signature")) rows.push({ field: "bug_signature", label: "Bug signature", value: extras.bug ?? "matched", cited: true });
  return rows;
}

// --- Renderable labels -------------------------------------------------------

const REAL_FIELDS = new Set<string>(VALID_EVIDENCE);

/**
 * Last line of defence before the UI: a Label from a model that cites nothing, or
 * cites a field that does not exist, is shown as `unknown`, never as a Label.
 */
export function renderableLabel(l: LabelRecord): LabelRecord {
  if (l.source === "model" && l.label !== "unknown") {
    const bad = l.evidenceFields.length === 0 || l.evidenceFields.some((f) => !REAL_FIELDS.has(f));
    if (bad) {
      return { ...l, label: "unknown", evidenceFields: [], humanPrompt: "The model's citation was invalid, so no Label is shown. Choose a Label and give a reason." };
    }
  }
  return l;
}
