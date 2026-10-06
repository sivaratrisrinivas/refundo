import { eq } from "drizzle-orm";
import { appendAudit } from "@/lib/audit";
import { nowIso } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/client";
import { can, type Persona } from "@/lib/auth/personas";
import { idempotencyKey, linearPayload, orbPayload, validateMockPayload, zendeskPayload, type MockSystem } from "@/lib/mocks/payloads";
import { loadPolicy } from "@/lib/policy/policy";
import { assembleCase } from "./assemble";
import { approveGate } from "./gates";
import { buildReplyDecision, validateReply } from "./reply";
import { OverrideError, validateOverride } from "./overrides";
import { runCase, type RunDeps } from "./run";
import { loadDecision, saveDecision } from "./store";
import type { DecisionRecord, Override } from "./types";

export type RefusalCode =
  | "forbidden" | "not_found" | "already_approved" | "session_already_credited" | "needs_lead" | "needs_human"
  | "recommend_only" | "over_cap" | "no_reply" | "invalid_reply" | "bad_payload";

export interface Refusal { ok: false; code: RefusalCode; message: string }
export type ApproveResult = { ok: true; decision: DecisionRecord; written: MockSystem[] } | Refusal;

const refuse = (code: RefusalCode, message: string): Refusal => ({ ok: false, code, message });

/** What the account can take right now, from its current 30-day Credit. */
function allowedAmount(d: DecisionRecord, plan: "core" | "pro", granted: number): number {
  const policy = loadPolicy();
  const cap = policy.capsCents[plan];
  const bumped = d.capStatus === "chargeback_bump" || d.capStatus === "bump_clamped";
  const ceiling = bumped ? Math.floor(cap * policy.chargebackMaxMultiplier) : cap;
  return Math.max(0, ceiling - granted);
}

/**
 * The case seam for Approval. One transaction writes the Orb ledger entry, the
 * Zendesk reply and tags, a Linear issue when a known bug matched, and one
 * audit row, or nothing at all. All gates run here, on the server.
 */
export function approveDecision(
  db: Db,
  input: { ticketId: string; persona: Persona },
  hooks: { beforeCommit?: () => void } = {},
): ApproveResult {
  if (!can(input.persona, "decision.approve")) return refuse("forbidden", `${input.persona} may not approve`);
  const d = loadDecision(db, input.ticketId);
  const c = assembleCase(db, input.ticketId);
  if (!d || !c || !c.session) return refuse("not_found", "no Decision to approve for this Ticket");
  const gate = approveGate(input.persona, d, c.account.plan);
  if (!gate.enabled && gate.code !== "no_reply") return refuse(gate.code!, gate.reason ?? "refused");
  if (c.account.plan !== "core" && c.account.plan !== "pro") return refuse("recommend_only", "unsupported plan");
  if (d.amountCents > allowedAmount(d, c.account.plan, c.account.creditsGranted30dCents)) {
    return refuse("over_cap", "the amount exceeds what the Cap allows today; re-run the Case");
  }
  if (!d.reply) return refuse("no_reply", "there is no validated reply to send");
  if (!validateReply(d.reply, buildReplyDecision(c, d)).ok) return refuse("invalid_reply", "the reply no longer validates against the Decision");

  const credited = d.amountCents > 0;
  const sessionId = c.session.id;
  const clauseIds = [...d.clauses];
  const ids = { sessionId, ticketId: d.ticketId };
  const writes: { system: MockSystem; payload: unknown }[] = [];
  if (credited) {
    writes.push({
      system: "orb",
      payload: orbPayload({ orbCustomerId: c.account.orbCustomerId, amountCents: d.amountCents, decisionId: d.id, sessionId, ticketId: d.ticketId, clauseIds, policyVersion: d.policyVersion }),
    });
  }
  writes.push({ system: "zendesk", payload: zendeskPayload({ ticketId: d.ticketId, reply: d.reply, clauseIds: clauseIds.filter((x) => d.lines.some((l) => l.clause === x && l.creditCents > 0)), credited }) });
  if (credited && d.fileLinear) {
    const bugLine = d.lines.find((l) => l.label === "known_bug" && l.creditCents > 0)!;
    const cpIds = d.lines.filter((l) => l.label === "known_bug" && l.creditCents > 0).map((l) => l.checkpointId);
    const sig = c.bugSignatures.find((b) => new RegExp(b.pattern, "i").test(
      `${c.checkpoints.find((k) => k.id === bugLine.checkpointId)!.filesChanged.join("\n")}\n${c.checkpoints.find((k) => k.id === bugLine.checkpointId)!.errorText ?? ""}`,
    ));
    if (sig) writes.push({ system: "linear", payload: linearPayload({ bug: sig, sessionId, ticketId: d.ticketId, checkpointIds: cpIds }) });
  }
  for (const w of writes) {
    const v = validateMockPayload(w.system, w.payload);
    if (!v.ok) return refuse("bad_payload", `${w.system} payload rejected: ${v.error}`);
  }

  try {
    const approvedAt = nowIso();
    db.transaction((tx) => {
      for (const w of writes) {
        tx.insert(schema.outbox).values({
          id: `OB-${d.id}-${w.system}`, decisionId: d.id, system: w.system, payload: w.payload, createdAt: approvedAt,
          idempotencyKey: idempotencyKey(w.system, ids),
        }).run();
      }
      tx.update(schema.decisions).set({ status: "approved", approver: input.persona, approvedAt }).where(eq(schema.decisions.id, d.id)).run();
      tx.update(schema.tickets).set({ status: "approved" }).where(eq(schema.tickets.id, d.ticketId)).run();
      if (credited) {
        tx.update(schema.accounts).set({ creditsGranted30dCents: c.account.creditsGranted30dCents + d.amountCents }).where(eq(schema.accounts.id, c.account.id)).run();
      }
      appendAudit(tx, {
        actor: input.persona,
        action: "approve",
        payload: {
          decisionId: d.id, ticketId: d.ticketId, sessionId, amountCents: d.amountCents, clauses: clauseIds,
          lines: d.lines.filter((l) => l.creditCents > 0).map((l) => ({ checkpointId: l.checkpointId, label: l.label, creditCents: l.creditCents })),
          injectionDetected: d.injectionDetected, modelName: d.modelName, promptVersion: d.promptVersion,
          policyVersion: d.policyVersion, outbox: writes.map((w) => w.system),
          overrides: d.overrides.filter((o) => o.kind !== "reply").length,
        },
      });
      hooks.beforeCommit?.();
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|constraint/i.test(msg)) return refuse("session_already_credited", "this Session already has an approved write; no second Credit is allowed");
    throw e;
  }
  return { ok: true, decision: loadDecision(db, d.ticketId)!, written: writes.map((w) => w.system) };
}

export type OverrideInput =
  | { ticketId: string; persona: Persona; kind: "label"; checkpointId: string; to: string; reason: string }
  | { ticketId: string; persona: Persona; kind: "amount"; to: number; reason: string };

export type OverrideResult = { ok: true; decision: DecisionRecord } | Refusal;

/** A person changes a Label or the amount. A reason is mandatory; the change is audited and queued for the eval backlog. */
export async function overrideDecision(db: Db, input: OverrideInput, deps: RunDeps = {}): Promise<OverrideResult> {
  if (!can(input.persona, "decision.override")) return refuse("forbidden", `${input.persona} may not override`);
  const d = loadDecision(db, input.ticketId);
  if (!d) return refuse("not_found", "run the Case before overriding it");
  if (d.status === "approved") return refuse("already_approved", "an approved Decision cannot be overridden");
  try {
    validateOverride({ kind: input.kind, reason: input.reason, to: input.to, checkpointId: input.kind === "label" ? input.checkpointId : undefined }, d.ceilingCents);
  } catch (e) {
    if (e instanceof OverrideError) return refuse("bad_payload", e.message);
    throw e;
  }
  const from = input.kind === "label"
    ? (d.labels.find((l) => l.checkpointId === input.checkpointId)?.label ?? "unresolved")
    : d.amountCents;
  const override: Override = {
    kind: input.kind, checkpointId: input.kind === "label" ? input.checkpointId : undefined, from, to: input.to,
    reason: input.reason.trim(), actor: input.persona, ts: nowIso(),
  };
  const c = assembleCase(db, input.ticketId);
  db.transaction((tx) => {
    tx.update(schema.decisions).set({ overrides: [...d.overrides, override], overrideReason: override.reason }).where(eq(schema.decisions.id, d.id)).run();
    appendAudit(tx, {
      actor: input.persona, action: "override",
      payload: { ticketId: d.ticketId, sessionId: d.sessionId, ...override, checkpoint: input.kind === "label" ? snapshot(c, input.checkpointId) : null },
    });
  });
  const next = await runCase(db, input.ticketId, deps);
  return { ok: true, decision: next };
}

function snapshot(c: ReturnType<typeof assembleCase>, checkpointId: string) {
  const k = c?.checkpoints.find((x) => x.id === checkpointId);
  return k ? { id: k.id, seq: k.seq, requestText: k.requestText, agentClaimText: k.agentClaimText, filesChanged: k.filesChanged, appTest: k.appTest } : null;
}

export { saveDecision };
