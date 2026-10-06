import { clauseForLabel, loadPolicy, type Policy } from "./policy";
import { loopIsCredited } from "./rules";
import type { CheckpointLabel, ClauseId, Label, LabelSource, Mode, Plan } from "./types";

/**
 * Pure pricing. Inputs are final Labels, Checkpoint costs and account facts.
 * It never sees Ticket text or any model output other than Labels, so prompt
 * injection cannot move money. Everything is integer cents.
 */

export interface PriceCheckpoint {
  id: string;
  seq: number;
  costCents: number;
  mode: Mode;
}

export interface PriceInput {
  checkpoints: PriceCheckpoint[];
  labels: CheckpointLabel[];
  account: { plan: Plan; creditsGranted30dCents: number };
  disputeThreatened: boolean;
  policy?: Policy;
}

export interface CreditLine {
  checkpointId: string;
  seq: number;
  label: Label;
  source: LabelSource | "none";
  clause: ClauseId | null;
  costCents: number;
  creditPct: number;
  /** Credit before any Cap clamp. */
  preCapCents: number;
  /** Final Credit for this line. Lines always sum to the amount. */
  creditCents: number;
  needsHuman: boolean;
}

export type DecisionStatus = "ready" | "needs_human" | "needs_lead" | "recommend_only";
export type CapStatus = "within_cap" | "clamped" | "chargeback_bump" | "bump_clamped" | "enterprise";

export interface PriceResult {
  lines: CreditLine[];
  subtotalCents: number;
  amountCents: number;
  clauses: ClauseId[];
  status: DecisionStatus;
  needsHuman: boolean;
  needsLead: boolean;
  capStatus: CapStatus;
  /** Highest amount that can be approved (null for Enterprise, which is never approved). */
  ceilingCents: number | null;
  headroomCents: number | null;
  fileLinear: boolean;
  routeTo: "account_manager" | null;
  policyVersion: string;
}

const SOURCE_RANK: Record<LabelSource, number> = { human: 3, rule: 2, model: 1 };

/** Human over rule over model; a low-confidence model Label is `unknown`. */
export function resolveFinalLabel(
  candidates: CheckpointLabel[],
  policy: Policy,
): { label: Label; source: LabelSource | "none"; repeat?: number } {
  if (candidates.length === 0) return { label: "unknown", source: "none" };
  const best = [...candidates].sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source])[0]!;
  if (best.source === "model" && best.confidence < policy.minConfidence) {
    return { label: "unknown", source: "model" };
  }
  return { label: best.label, source: best.source, repeat: best.repeat };
}

/** Split `total` across `weights` in integer cents (largest remainder, ties to the earliest line). */
export function allocateCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  // Integer arithmetic only, so ties are exact and never depend on float noise.
  const floors = weights.map((w) => Math.floor((total * w) / sum));
  const rems = weights.map((w) => (total * w) % sum);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = rems
    .map((rem, i) => ({ i, rem }))
    .filter(({ i }) => weights[i]! > 0)
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

export function price(input: PriceInput): PriceResult {
  const policy = input.policy ?? loadPolicy();

  const byCheckpoint = new Map<string, CheckpointLabel[]>();
  for (const l of input.labels) {
    const list = byCheckpoint.get(l.checkpointId) ?? [];
    list.push(l);
    byCheckpoint.set(l.checkpointId, list);
  }

  // 1. Drop free-mode Checkpoints. 2-3. Final Label, Clause, line in cents.
  const lines: CreditLine[] = input.checkpoints
    .filter((c) => c.mode !== "free" && c.costCents > 0)
    .sort((a, b) => a.seq - b.seq)
    .map((c) => {
      const final = resolveFinalLabel(byCheckpoint.get(c.id) ?? [], policy);
      const clauseId = clauseForLabel(final.label);
      const clause = clauseId ? policy.clauses[clauseId] : null;
      let pct = clause?.creditPct ?? 0;
      if (final.label === "loop" && final.repeat !== undefined && !loopIsCredited(final.repeat, policy)) {
        pct = 0;
      }
      const preCapCents = Math.round((c.costCents * pct) / 100);
      const needsHuman =
        final.label === "unknown" || (clause?.needsHuman === true && final.source !== "human");
      return {
        checkpointId: c.id,
        seq: c.seq,
        label: final.label,
        source: final.source,
        clause: clauseId,
        costCents: c.costCents,
        creditPct: pct,
        preCapCents,
        creditCents: preCapCents,
        needsHuman,
      };
    });

  // 4. Subtotal and human flag.
  const subtotalCents = lines.reduce((s, l) => s + l.preCapCents, 0);
  const needsHuman = lines.some((l) => l.needsHuman);
  const clauses = [...new Set(lines.flatMap((l) => (l.clause ? [l.clause] : [])))].sort() as ClauseId[];
  const fileLinear = lines.some((l) => l.label === "known_bug" && l.creditCents > 0);
  const base = { clauses, fileLinear, policyVersion: policy.version, subtotalCents };

  // 5. Enterprise is recommendation-only.
  if (input.account.plan === "enterprise") {
    return {
      ...base,
      lines,
      amountCents: subtotalCents,
      status: "recommend_only",
      needsHuman,
      needsLead: false,
      capStatus: "enterprise",
      ceilingCents: null,
      headroomCents: null,
      routeTo: "account_manager",
    };
  }

  // 6-7. Headroom, clamp, Chargeback bump.
  const cap = policy.capsCents[input.account.plan];
  const granted = input.account.creditsGranted30dCents;
  const headroom = Math.max(0, cap - granted);
  const bumpCeiling = Math.max(0, Math.floor(cap * policy.chargebackMaxMultiplier) - granted);

  let ceiling = headroom;
  let capStatus: CapStatus = "within_cap";
  let needsLead = false;
  if (subtotalCents > headroom) {
    if (input.disputeThreatened) {
      ceiling = bumpCeiling;
      needsLead = policy.chargebackNeedsLead;
      capStatus = subtotalCents > bumpCeiling ? "bump_clamped" : "chargeback_bump";
    } else {
      needsLead = true;
      capStatus = "clamped";
    }
  }
  // A threatened dispute that fits inside Headroom does not use the bump: the ceiling stays Headroom, so nobody
  // can approve above Headroom without a Lead (the bump is applied only when the proposal needs it).

  const amountCents = Math.min(subtotalCents, ceiling);
  let finalLines = lines;
  if (amountCents < subtotalCents) {
    const shares = allocateCents(
      amountCents,
      lines.map((l) => l.preCapCents),
    );
    finalLines = lines.map((l, i) => ({ ...l, creditCents: shares[i]! }));
  }

  return {
    ...base,
    lines: finalLines,
    amountCents,
    status: needsHuman ? "needs_human" : needsLead ? "needs_lead" : "ready",
    needsHuman,
    needsLead,
    capStatus,
    ceilingCents: ceiling,
    headroomCents: headroom,
    routeTo: null,
  };
}
