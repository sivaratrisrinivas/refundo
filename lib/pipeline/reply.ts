import type { ModelProvider } from "@/lib/models";
import type { ReplyDecision } from "@/lib/models";
import { usd } from "@/lib/models/reply-template";
import type { CaseData, DecisionRecord, TraceStep } from "./types";

export type ReplyViolationKind =
  | "too_long" | "missing_line" | "missing_total" | "extra_number" | "cash_language" | "fault_admission"
  | "future_promise" | "missing_prior_credit" | "missing_plan_mode_explanation";

export interface ReplyViolation { kind: ReplyViolationKind; detail: string }

const MAX_WORDS = 180;
export const CASH = /\b(?:refunds?|refunded|cash|money back|reimburs\w*|back to your card|to your card|bank account|chargebacks?|wire transfer|paypal|original payment)\b/i;
export const FAULT = /\b(?:our fault|my fault|we (?:were|are) (?:at fault|wrong|to blame)|we messed up|this was (?:our|my) (?:fault|mistake|error)|we take (?:full )?responsibility|we are responsible|we admit)\b/i;
const PROMISE = /\b(?:we will make sure|i will make sure|we'?ll make sure|guarantee\w*|i promise|we promise|never happen again|you will receive|you'?ll receive|will be credited|will be refunded|we will ensure|we'?ll ensure|will definitely)\b/i;

export function buildReplyDecision(c: CaseData, d: DecisionRecord): ReplyDecision {
  return {
    customerFirstName: c.account.name.split(" ")[0] ?? "there",
    sessionId: c.session?.id ?? "",
    amountCents: d.amountCents,
    subtotalCents: d.subtotalCents,
    status: d.status === "approved" ? "ready" : d.status,
    lines: d.lines.map((l) => ({ seq: l.seq, label: l.label, creditCents: l.creditCents })),
    priorCredit: c.priorCredit ?? undefined,
    routeTo: d.routeTo,
    clamped: d.capStatus === "clamped" || d.capStatus === "bump_clamped",
    hasPlanning: d.labels.some((l) => l.label === "planning"),
  };
}

function allowedDollar(rd: ReplyDecision): Set<string> {
  const s = new Set<string>([usd(rd.amountCents), usd(rd.subtotalCents)]);
  for (const l of rd.lines) s.add(usd(l.creditCents));
  if (rd.priorCredit) s.add(usd(rd.priorCredit.amountCents));
  return s;
}

function allowedBare(rd: ReplyDecision): Set<string> {
  const s = new Set<string>();
  for (const l of rd.lines) s.add(String(l.seq));
  for (const m of rd.sessionId.match(/\d+/g) ?? []) s.add(m);
  for (const m of rd.priorCredit?.approvedOn.match(/\d+/g) ?? []) s.add(m);
  return s;
}

/** Reject a draft that omits a line, invents a number, promises cash, admits fault, or promises an outcome. */
export function validateReply(text: string, rd: ReplyDecision): { ok: boolean; violations: ReplyViolation[] } {
  const v: ReplyViolation[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words >= MAX_WORDS) v.push({ kind: "too_long", detail: `${words} words` });

  const credited = rd.lines.filter((l) => l.creditCents > 0);
  if (!rd.priorCredit) {
    for (const l of credited) {
      const hit = text.split("\n").some((ln) => new RegExp(`Checkpoint ${l.seq}\\b`).test(ln) && ln.includes(usd(l.creditCents)));
      if (!hit) v.push({ kind: "missing_line", detail: `Checkpoint ${l.seq} ${usd(l.creditCents)}` });
    }
    if (credited.length > 0 && !text.includes(`credit: ${usd(rd.amountCents)}`)) v.push({ kind: "missing_total", detail: usd(rd.amountCents) });
  }

  const dollars = text.match(/\$[\d,]+(?:\.\d+)?/g) ?? [];
  const okDollar = allowedDollar(rd);
  for (const d of dollars) if (!okDollar.has(d)) v.push({ kind: "extra_number", detail: d });
  const bare = text.replace(/\$[\d,]+(?:\.\d+)?/g, " ").match(/\d+(?:\.\d+)?/g) ?? [];
  const okBare = allowedBare(rd);
  for (const b of bare) if (!okBare.has(b)) v.push({ kind: "extra_number", detail: b });

  if (CASH.test(text)) v.push({ kind: "cash_language", detail: text.match(CASH)![0] });
  if (FAULT.test(text)) v.push({ kind: "fault_admission", detail: text.match(FAULT)![0] });
  if (PROMISE.test(text)) v.push({ kind: "future_promise", detail: text.match(PROMISE)![0] });

  if (rd.priorCredit && !(text.includes(usd(rd.priorCredit.amountCents)) && /already/i.test(text))) {
    v.push({ kind: "missing_prior_credit", detail: "the earlier Credit is not referenced" });
  }
  if (rd.hasPlanning && rd.amountCents === 0 && !/plan mode/i.test(text)) {
    v.push({ kind: "missing_plan_mode_explanation", detail: "Plan Mode billing is not explained" });
  }
  return { ok: v.length === 0, violations: v };
}

export interface DraftOutcome { reply: string | null; trace: TraceStep; rejected: ReplyViolation[][] }

/** Stage 8. Rejected drafts are discarded: they never reach storage or the UI. */
export async function draftReply(provider: ModelProvider, rd: ReplyDecision, seed: string, maxAttempts = 3): Promise<DraftOutcome> {
  let costUsd = 0, latencyMs = 0;
  const rejected: ReplyViolation[][] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await provider.call("reply", { decision: rd }, { seed, attempt });
    costUsd += r.costUsd;
    latencyMs += r.latencyMs;
    if (typeof r.output === "string") {
      const res = validateReply(r.output, rd);
      if (res.ok) {
        return { reply: r.output, rejected, trace: { step: "draft reply", ok: true, attempts: attempt + 1, costUsd, latencyMs, model: r.modelName, note: rejected.length ? `${rejected.length} draft(s) rejected by the validator` : undefined } };
      }
      rejected.push(res.violations);
    } else {
      rejected.push([{ kind: "too_long", detail: "reply was not text" }]);
    }
  }
  return { reply: null, rejected, trace: { step: "draft reply", ok: false, attempts: maxAttempts, costUsd, latencyMs, model: provider.name, note: "every draft failed validation; routed to a human" } };
}
