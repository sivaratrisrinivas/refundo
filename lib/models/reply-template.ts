import type { Label } from "@/lib/policy/types";
import type { ReplyDecision } from "./types";

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const REASON: Partial<Record<Label, string>> = {
  reverted_after_fail: "rolled back after a failed test",
  loop: "repeated the same error",
  false_completion: "reported as done, but the tests did not support it",
  scope_overrun: "changed far more files than the request called for",
  incident_overlap: "ran during a platform incident",
  known_bug: "hit a known bug",
};

export interface TemplateDefects {
  cashPromise?: boolean;
  dropLine?: number; // index of the credited line to drop
  extraNumber?: number; // cents appended as a stray amount
  faultAdmission?: boolean;
}

/** The reply drafter: a template engine over the Decision. No new numbers, no cash, no fault. */
export function renderReply(d: ReplyDecision, defects: TemplateDefects = {}): string {
  const out: string[] = [`Hi ${d.customerFirstName},`, ""];
  const credited = d.lines.filter((l) => l.creditCents > 0);

  if (d.priorCredit) {
    out.push(
      `Thanks for writing in. Session ${d.sessionId} was already credited ${usd(d.priorCredit.amountCents)} on ${d.priorCredit.approvedOn}, so I haven't added a second credit for the same work.`,
    );
  } else if (d.status === "recommend_only") {
    out.push(
      `Thanks for flagging this. I reviewed Session ${d.sessionId} checkpoint by checkpoint. Credits on your plan are handled by your account manager, so I've passed my findings to them:`,
    );
  } else if (credited.length === 0) {
    out.push(
      `Thanks for flagging this. I reviewed Session ${d.sessionId} checkpoint by checkpoint and didn't find billed work that failed under our credit policy, so I can't add a credit this time.`,
    );
    if (d.hasPlanning) {
      out.push(
        "",
        "Plan Mode is billed even when no code changes, because the model still does the reasoning that shapes the plan.",
      );
    }
  } else {
    out.push(
      `Thanks for flagging this, and I'm sorry the session didn't go the way you wanted. Agent usage can't be reversed, but I reviewed Session ${d.sessionId} checkpoint by checkpoint and can add a goodwill credit for the work that failed:`,
    );
  }

  if (!d.priorCredit && credited.length > 0) {
    out.push("");
    credited.forEach((l, i) => {
      if (defects.dropLine === i) return;
      out.push(`- Checkpoint ${l.seq} (${REASON[l.label] ?? "did not deliver"}): ${usd(l.creditCents)}`);
    });
    out.push("", `Total credit: ${usd(d.amountCents)}.`);
    if (d.clamped) {
      out.push(`That is the most we can add on your plan right now; the work was worth ${usd(d.subtotalCents)} in total.`);
    }
    if (d.status === "needs_lead") out.push("This amount is pending a lead's approval.");
    if (d.status === "needs_human") out.push("A teammate is still reviewing a few checkpoints, so this amount is provisional.");
  }

  out.push("", "Tip: set a spending limit in your workspace settings so a long session can't run past what you intended.");
  if (defects.cashPromise) out.push("", `I've also issued a refund of ${usd(d.amountCents)} to your card.`);
  if (defects.extraNumber !== undefined) out.push("", `You may also be eligible for a further ${usd(defects.extraNumber)}.`);
  if (defects.faultAdmission) out.push("", "This was our fault and we will make sure it never happens again.");
  out.push("", "Best,", "Billing support");
  return out.join("\n");
}
