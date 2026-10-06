import { allocateCents, type CreditLine, type PriceResult } from "@/lib/policy/engine";
import { LABELS, type CheckpointLabel, type Label } from "@/lib/policy/types";
import type { Override } from "./types";

export class OverrideError extends Error {}

/** An Override always carries a reason. */
export function validateOverride(o: Pick<Override, "kind" | "reason" | "to" | "checkpointId">, ceilingCents: number | null): void {
  if (o.kind === "reply") return; // a reply edit is a draft change, not a deviation from policy
  if (!o.reason || o.reason.trim().length < 3) throw new OverrideError("an Override needs a written reason");
  if (o.kind === "label") {
    if (!o.checkpointId) throw new OverrideError("a label Override needs a Checkpoint");
    if (!LABELS.includes(o.to as Label)) throw new OverrideError(`unknown Label: ${String(o.to)}`);
  } else {
    if (typeof o.to !== "number" || !Number.isInteger(o.to) || o.to < 0) throw new OverrideError("amount must be whole cents, zero or more");
    if (ceilingCents === null) throw new OverrideError("this Case is recommendation-only; no amount can be set");
    if (o.to > ceilingCents) throw new OverrideError("amount is above the highest approvable amount");
  }
}

/** Human Labels from Overrides, to be fed to the engine (human beats rule and model). */
export function overrideLabels(overrides: Override[]): CheckpointLabel[] {
  const last = new Map<string, Override>();
  for (const o of overrides) if (o.kind === "label" && o.checkpointId) last.set(o.checkpointId, o);
  return [...last.values()].map((o) => ({
    checkpointId: o.checkpointId!, label: o.to as Label, evidenceFields: [], source: "human", confidence: 1,
    overrideReason: o.reason,
  }));
}

/** Re-split a human-set amount across the lines, to the cent. */
export function applyAmountOverride(result: PriceResult, cents: number): PriceResult {
  const weights = result.lines.map((l) => l.preCapCents);
  const basis = weights.some((w) => w > 0) ? weights : result.lines.map((l) => l.costCents);
  const shares = allocateCents(cents, basis);
  const lines: CreditLine[] = result.lines.map((l, i) => ({ ...l, creditCents: shares[i]! }));
  return { ...result, lines, amountCents: cents };
}

export function latestAmountOverride(overrides: Override[]): number | null {
  const a = overrides.filter((o) => o.kind === "amount");
  return a.length ? (a[a.length - 1]!.to as number) : null;
}
