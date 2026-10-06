import { guard } from "@/lib/auth/guard";
import { nowIso } from "@/lib/clock";
import { appDb } from "@/lib/db/app-db";
import { getProvider, MODEL_NAMES, type ModelName } from "@/lib/models";
import { approveDecision, overrideDecision, type Refusal } from "@/lib/pipeline/approve";
import { editReply } from "@/lib/pipeline/decide";
import { runCase } from "@/lib/pipeline/run";

const STATUS: Record<Refusal["code"], number> = {
  forbidden: 403, needs_lead: 403, not_found: 404, already_approved: 409, session_already_credited: 409,
  needs_human: 409, recommend_only: 409, over_cap: 409, no_reply: 409, invalid_reply: 409, bad_payload: 422,
};

export const refusal = (r: Refusal) => Response.json({ ok: false, code: r.code, error: r.message }, { status: STATUS[r.code] });

async function body(request: Request): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

function modelFrom(b: Record<string, unknown>): ModelName {
  return MODEL_NAMES.includes(b.model as ModelName) ? (b.model as ModelName) : "sim-a";
}

export async function handleRun(request: Request, ticketId: string): Promise<Response> {
  const g = guard(request, "case.run");
  if (!g.ok) return g.response;
  const b = await body(request);
  try {
    const d = await runCase(appDb(), ticketId, { provider: getProvider(modelFrom(b)) });
    return Response.json({ ok: true, status: d.status, amountCents: d.amountCents });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 404 });
  }
}

export async function handleApprove(request: Request, ticketId: string): Promise<Response> {
  const g = guard(request, "decision.approve");
  if (!g.ok) return g.response;
  const r = approveDecision(appDb(), { ticketId, persona: g.persona });
  return r.ok ? Response.json({ ok: true, written: r.written, status: "approved" }) : refusal(r);
}

export async function handleOverride(request: Request, ticketId: string): Promise<Response> {
  const g = guard(request, "decision.override");
  if (!g.ok) return g.response;
  const b = await body(request);
  const provider = getProvider(modelFrom(b));
  const base = { ticketId, persona: g.persona, reason: String(b.reason ?? "") };
  const r =
    b.kind === "amount"
      ? await overrideDecision(appDb(), { ...base, kind: "amount", to: Number(b.to) }, { provider })
      : await overrideDecision(appDb(), { ...base, kind: "label", checkpointId: String(b.checkpointId ?? ""), to: String(b.to ?? "") }, { provider });
  return r.ok ? Response.json({ ok: true, status: r.decision.status, amountCents: r.decision.amountCents }) : refusal(r);
}

export async function handleReply(request: Request, ticketId: string): Promise<Response> {
  const g = guard(request, "decision.override");
  if (!g.ok) return g.response;
  const b = await body(request);
  try {
    const r = editReply(appDb(), ticketId, String(b.reply ?? ""), g.persona, nowIso());
    return r.ok
      ? Response.json({ ok: true })
      : Response.json({ ok: false, code: "invalid_reply", error: "The edited reply failed validation.", violations: r.violations }, { status: 422 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }
}
