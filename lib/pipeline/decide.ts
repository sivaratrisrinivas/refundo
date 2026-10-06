import type { Db } from "@/lib/db/client";
import { assembleCase } from "./assemble";
import { buildReplyDecision, validateReply, type ReplyViolation } from "./reply";
import { loadDecision, saveDecision } from "./store";
import type { DecisionRecord } from "./types";

export type EditReplyResult =
  | { ok: true; decision: DecisionRecord }
  | { ok: false; violations: ReplyViolation[] };

/** A specialist edits the reply. It is validated again here, and again before Approval. */
export function editReply(db: Db, ticketId: string, text: string, actor: string, ts: string): EditReplyResult {
  const d = loadDecision(db, ticketId);
  const c = assembleCase(db, ticketId);
  if (!d || !c) throw new Error("no Decision to edit");
  if (d.status === "approved") throw new Error("an approved Decision cannot be edited");
  const res = validateReply(text, buildReplyDecision(c, d));
  if (!res.ok) return { ok: false, violations: res.violations };
  const next: DecisionRecord = {
    ...d, reply: text,
    overrides: [...d.overrides, { kind: "reply", from: d.reply ?? "", to: text, reason: "", actor, ts }],
  };
  saveDecision(db, next);
  return { ok: true, decision: next };
}
