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

interface Frame { id: string; label: "good" | "bad"; defect?: ReplyViolationKind; text: string }

/**
 * Replies written by hand, in different words from the template, so the validator is also measured on text it did
 * not generate. {first} {session} {seq} {amt} {total} fill from a Decision with exactly one credited line.
 */
const HAND_WRITTEN: Frame[] = [
  { id: "hw-good-1", label: "good", text: "Hi {first}, I went through Session {session} and found a step that did not hold up. Checkpoint {seq} (rolled back after its test failed): {amt}. Total credit: {total}. One practical tip: a spending limit in workspace settings stops a long session running on. Best, Billing support" },
  { id: "hw-good-2", label: "good", text: "Hello {first},\n\nThank you for your patience. After reading Session {session} closely, I'm adding a goodwill credit for this step:\n- Checkpoint {seq} (work that did not deliver): {amt}\n\nTotal credit: {total}.\n\nTip: ask the agent to confirm each change against a test before moving on.\n\nKind regards" },
  { id: "hw-good-3", label: "good", text: "{first}, here is what I found in Session {session}. Checkpoint {seq} (credited): {amt}. Total credit: {total}. If it helps, a short spending cap in your settings is the easiest way to keep surprises away. Thanks for flagging this." },
  { id: "hw-good-4", label: "good", text: "Hi {first}. I'm sorry this session was frustrating. I reviewed Session {session} and can add a goodwill credit. Checkpoint {seq} (reported as finished but not working): {amt}. Total credit: {total}. Tip: set a budget limit so you are told before a session grows. Best wishes, Billing" },
  { id: "hw-bad-cash-1", label: "bad", defect: "cash_language", text: "Hi {first}, Session {session}: Checkpoint {seq}: {amt}. Total credit: {total}. I'll also send the money back to your card today. Tip: set a limit." },
  { id: "hw-bad-cash-2", label: "bad", defect: "cash_language", text: "Hello {first}. Checkpoint {seq} (failed): {amt}. Total credit: {total}. You are entitled to a full refund too. Tip: use a spending limit." },
  { id: "hw-bad-fault-1", label: "bad", defect: "fault_admission", text: "Hi {first}, this was our fault and we feel terrible. Checkpoint {seq} (failed): {amt}. Total credit: {total}. Tip: set a budget limit for Session {session}." },
  { id: "hw-bad-fault-2", label: "bad", defect: "fault_admission", text: "{first}, we messed up on Session {session}. Checkpoint {seq}: {amt}. Total credit: {total}. Tip: add a spending limit." },
  { id: "hw-bad-promise-1", label: "bad", defect: "future_promise", text: "Hi {first}, Checkpoint {seq} (failed): {amt}. Total credit: {total}. I guarantee future sessions will go better. Tip: set a limit. Session {session}." },
  { id: "hw-bad-promise-2", label: "bad", defect: "future_promise", text: "Hello {first}. Session {session}, Checkpoint {seq}: {amt}. Total credit: {total}. We will make sure this is fixed for you. Tip: spending limit." },
  { id: "hw-bad-number-1", label: "bad", defect: "extra_number", text: "Hi {first}, Session {session}, Checkpoint {seq} (failed): {amt}. Total credit: {total}. Expect it within 24 hours. Tip: set a limit." },
  { id: "hw-bad-number-2", label: "bad", defect: "extra_number", text: "Hello {first}. Checkpoint {seq}: {amt}. Total credit: {total}, plus a $25.00 courtesy bonus. Tip: spending limit. Session {session}." },
  { id: "hw-bad-line-1", label: "bad", defect: "missing_line", text: "Hi {first}, I reviewed Session {session} and I'm adding a credit. Total credit: {total}. Tip: set a spending limit." },
  { id: "hw-bad-total-1", label: "bad", defect: "missing_total", text: "Hi {first}. Session {session}, Checkpoint {seq} (failed): {amt}. That is what I can add this time. Tip: use a spending limit." },
];

function fill(t: string, d: ReplyDecision): string {
  const c = d.lines.find((l) => l.creditCents > 0)!;
  const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
  return t.replaceAll("{first}", d.customerFirstName).replaceAll("{session}", d.sessionId).replaceAll("{seq}", String(c.seq)).replaceAll("{amt}", usd(c.creditCents)).replaceAll("{total}", usd(d.amountCents));
}

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
    if (!d.priorCredit && credited.length === 1 && d.amountCents === credited[0]!.creditCents) {
      for (const f of HAND_WRITTEN) add(f.id, fill(f.text, d), f.label, f.defect);
    }
    if (d.priorCredit) add("no-prior", clean.replace(/already credited/, "credited"), "bad", "missing_prior_credit");
    if (d.hasPlanning && d.amountCents === 0) add("no-plan-mode", clean.replace(/Plan Mode is billed[^\n]*\n?/, ""), "bad", "missing_plan_mode_explanation");
  }
  return out;
}
