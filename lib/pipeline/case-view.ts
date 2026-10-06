import type { Persona } from "@/lib/auth/personas";
import { ageHours } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { loadPolicy } from "@/lib/policy/policy";
import type { Checkpoint, Label } from "@/lib/policy/types";
import { assembleCase } from "./assemble";
import { approveGate, type Gate } from "./gates";
import { loadDecision } from "./store";
import type { CaseData, DecisionRecord, LabelRecord } from "./types";
import { buildEvidenceView, highlightSegments, renderableLabel, type EvidenceRow, type Segment } from "./view";

export interface CheckpointRow {
  checkpoint: Checkpoint;
  excluded: boolean;
  label: LabelRecord | null;
  /** True when no rule, model or person has settled this Checkpoint. */
  unresolved: boolean;
  line: DecisionRecord["lines"][number] | null;
  evidence: EvidenceRow[];
  incident?: string;
  bug?: string;
}

export interface CapMeter {
  plan: "core" | "pro" | "enterprise";
  capCents: number | null;
  grantedCents: number;
  headroomCents: number | null;
  ceilingCents: number | null;
  proposedCents: number;
  /** Credit that was granted before this Decision, as a share of the Cap. */
  bumpedCapCents: number | null;
}

export interface CaseView {
  ticket: { id: string; subject: string; segments: Segment[]; disputeThreatened: boolean; createdAt: string; ageHours: number; status: string };
  account: CaseData["account"];
  session: CaseData["session"];
  rows: CheckpointRow[];
  decision: DecisionRecord;
  gate: Gate;
  cap: CapMeter;
  clauseText: Record<string, string>;
  persona: Persona;
}

const CLAUSE_TEXT: Record<string, string> = {
  C1: "Delivered or planning work is not credited.",
  C2: "A rollback within 30 minutes of a failed test is credited in full.",
  C3: "A repeated error is credited in full from the third repeat.",
  C4: "A claim of completion that the evidence contradicts is credited in full.",
  C5: "Far more files than the request class median: credited at 50%, and a person decides.",
  C6: "An error during a public incident is credited in full.",
  C7: "A known bug is credited in full and a Linear issue is filed.",
  C8: "A rollback with no failure signal is the customer's choice and is not credited.",
};

export function getCaseView(db: Db, ticketId: string, persona: Persona): CaseView | null {
  const c = assembleCase(db, ticketId);
  const decision = loadDecision(db, ticketId);
  if (!c || !decision) return null;
  const policy = loadPolicy();
  const labels = new Map(decision.labels.map((l) => [l.checkpointId, renderableLabel(l)]));
  const lines = new Map(decision.lines.map((l) => [l.checkpointId, l]));
  const unresolved = new Set(decision.unresolved);
  const grievances = ((decision.complaint as { grievances?: { text: string }[] } | null)?.grievances) ?? [];

  const rows: CheckpointRow[] = c.checkpoints.map((cp) => {
    const label = labels.get(cp.id) ?? null;
    const inc = c.incidents.find((i) => cp.ts >= i.startsAt && cp.ts <= i.endsAt);
    const bug = c.bugSignatures.find((b) => new RegExp(b.pattern, "i").test(`${cp.filesChanged.join("\n")}\n${cp.errorText ?? ""}`));
    return {
      checkpoint: cp,
      excluded: cp.mode === "free" || cp.costCents === 0,
      label,
      unresolved: unresolved.has(cp.id),
      line: lines.get(cp.id) ?? null,
      evidence: buildEvidenceView(cp, label?.evidenceFields ?? [], { incident: inc ? `${inc.title} (${inc.startsAt.slice(0, 16)}Z to ${inc.endsAt.slice(11, 16)}Z)` : undefined, bug: bug?.name }),
      incident: inc?.title,
      bug: bug?.name,
    };
  });

  const plan = c.account.plan;
  const capCents = plan === "enterprise" ? null : policy.capsCents[plan];
  return {
    ticket: {
      id: c.ticket.id, subject: c.ticket.subject, segments: highlightSegments(c.ticket.body, grievances),
      disputeThreatened: c.ticket.disputeThreatened, createdAt: c.ticket.createdAt, ageHours: ageHours(c.ticket.createdAt), status: c.ticket.status,
    },
    account: c.account,
    session: c.session,
    rows,
    decision,
    gate: approveGate(persona, decision, plan),
    cap: {
      plan, capCents, grantedCents: c.account.creditsGranted30dCents, headroomCents: decision.headroomCents,
      ceilingCents: decision.ceilingCents, proposedCents: decision.amountCents,
      bumpedCapCents: capCents === null ? null : Math.floor(capCents * policy.chargebackMaxMultiplier),
    },
    clauseText: CLAUSE_TEXT,
    persona,
  };
}

export { LABEL_TEXT } from "./label-text";
