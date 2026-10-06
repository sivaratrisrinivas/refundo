import { renderReply } from "@/lib/models/reply-template";
import type { ReplyDecision } from "@/lib/models";
import type { ReplyViolationKind } from "./reply";

export interface LabeledReply {
  id: string;
  text: string;
  decision: ReplyDecision;
  label: "good" | "bad";
  /** The defect class the validator is expected to name, for bad replies. */
  defect?: ReplyViolationKind;
  /** Whether Simulated model B can inject this defect on its own. */
  injectedByModelB?: boolean;
}

const PAD = Array.from({ length: 200 }, (_, i) => `word${"abcdefghij"[i % 10]}`).join(" ");

/** A labeled set of good and bad replies, built from real Decisions. Used to measure the validator's TPR and TNR. */
export function buildLabeledReplySet(decisions: ReplyDecision[]): LabeledReply[] {
  const out: LabeledReply[] = [];
  for (const d of decisions) {
    const clean = renderReply(d);
    const add = (suffix: string, text: string, label: "good" | "bad", defect?: ReplyViolationKind, b = false) =>
      out.push({ id: `${d.sessionId}:${suffix}`, text, decision: d, label, defect, injectedByModelB: b });

    add("clean", clean, "good");
    add("edited-greeting", clean.replace(`Hi ${d.customerFirstName},`, `Hello ${d.customerFirstName}, thanks for your patience.`), "good");
    add("edited-closing", clean.replace("Best,", "Let me know if anything is unclear.\n\nBest,"), "good");
    add("edited-tip", clean.replace(/Tip:.*\n/, "Tip: a spending limit in workspace settings keeps long sessions in check.\n"), "good");

    const credited = d.lines.filter((l) => l.creditCents > 0);
    add("cash", renderReply(d, { cashPromise: true }), "bad", "cash_language", true);
    add("fault", renderReply(d, { faultAdmission: true }), "bad", "fault_admission", true);
    add("extra-number", renderReply(d, { extraNumber: 4321 }), "bad", "extra_number", true);
    add("promise", clean.replace("Best,", "I promise this will never happen again.\n\nBest,"), "bad", "future_promise");
    add("too-long", `${clean}\n\n${PAD}`, "bad", "too_long");
    add("cash-word", clean.replace("Best,", "A cash refund is not possible.\n\nBest,"), "bad", "cash_language");
    add("stray-count", clean.replace("Best,", "This is my 977th review of your account.\n\nBest,"), "bad", "extra_number");
    if (credited.length > 1) add("drop-line", renderReply(d, { dropLine: 0 }), "bad", "missing_line", true);
    if (credited.length > 0 && !d.priorCredit) {
      add("wrong-total", clean.replace(/Total (?:recommended )?credit: \$[\d.]+\./, "Total credit: $0.01."), "bad", "missing_total");
      add("wrong-line", clean.replace(/(Checkpoint \d+ \([^)]*\): )\$[\d.]+/, "$1$0.07"), "bad", "missing_line");
    }
    if (d.priorCredit) add("no-prior", clean.replace(/already credited/, "credited"), "bad", "missing_prior_credit");
    if (d.hasPlanning && d.amountCents === 0) add("no-plan-mode", clean.replace(/Plan Mode is billed[^\n]*\n?/, ""), "bad", "missing_plan_mode_explanation");
  }
  return out;
}
