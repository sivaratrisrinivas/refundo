import { can, type Persona } from "@/lib/auth/personas";
import type { DecisionRecord } from "./types";
import type { Plan } from "@/lib/policy/types";

export type GateCode = "forbidden" | "already_approved" | "recommend_only" | "needs_human" | "needs_lead" | "no_reply";
export interface Gate { enabled: boolean; code?: GateCode; reason?: string }

/**
 * Whether this Persona may approve this Decision right now. The Approve button,
 * the keyboard shortcut and the server all use this one function, so the UI can
 * never promise what the server will refuse.
 */
export function approveGate(
  persona: Persona,
  d: Pick<DecisionRecord, "status" | "needsHuman" | "needsLead" | "reply">,
  plan: Plan,
): Gate {
  if (!can(persona, "decision.approve")) return { enabled: false, code: "forbidden", reason: `${persona} may not approve` };
  if (d.status === "approved") return { enabled: false, code: "already_approved", reason: "already approved" };
  if (d.status === "recommend_only" || plan === "enterprise") {
    return { enabled: false, code: "recommend_only", reason: "Enterprise Credits are recommendation-only and go to the account manager" };
  }
  if (d.status === "needs_human" || d.needsHuman) {
    return { enabled: false, code: "needs_human", reason: "Settle the flagged Checkpoints first (Override with a reason)" };
  }
  if (d.needsLead && !can(persona, "decision.approve_lead")) {
    return { enabled: false, code: "needs_lead", reason: "Needs a Lead: over the Cap or carries a Chargeback bump" };
  }
  if (!d.reply) return { enabled: false, code: "no_reply", reason: "No validated reply to send" };
  return { enabled: true };
}
