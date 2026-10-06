"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { can } from "@/lib/auth/personas";
import { LABELS, type Label } from "@/lib/policy/types";
import type { CaseView as View } from "@/lib/pipeline/case-view";
import { LABEL_TEXT } from "@/lib/pipeline/label-text";
import { cn } from "@/lib/ui/cn";
import { ageLabel, usd } from "@/lib/ui/format";
import { SHORTCUT_HELP, shortcutAction } from "@/lib/ui/shortcuts";
import { LabelChip, ModeBadge, SourceBadge } from "./chips";

type Msg = { kind: "ok" | "error"; text: string } | null;

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && data.ok !== false, data };
}

const BANNER: Record<string, { tone: string; title: string }> = {
  ready: { tone: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100", title: "Ready to approve" },
  needs_human: { tone: "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100", title: "Needs a human decision" },
  needs_lead: { tone: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100", title: "Needs a Lead" },
  recommend_only: { tone: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100", title: "Recommendation only: route to the account manager" },
  approved: { tone: "border-emerald-500 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-50", title: "Approved" },
};

export function CaseView({ view }: { view: View }) {
  const router = useRouter();
  const { decision: d, persona } = view;
  const [selected, setSelected] = useState<number>(() => view.rows.find((r) => r.unresolved || (r.line && r.line.creditCents > 0))?.checkpoint.seq ?? view.rows[0]?.checkpoint.seq ?? 1);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(d.reply ?? "");
  const [replyViolations, setReplyViolations] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [amountReason, setAmountReason] = useState("");
  const [labelChoice, setLabelChoice] = useState<Label>("delivered");
  const [labelReason, setLabelReason] = useState("");

  useEffect(() => setReply(d.reply ?? ""), [d.reply]);

  const row = view.rows.find((r) => r.checkpoint.seq === selected) ?? view.rows[0];
  const status = d.status === "approved" ? "approved" : d.status;
  const banner = BANNER[status] ?? BANNER.ready!;
  const canOverride = can(persona, "decision.override") && d.status !== "approved";
  const canRun = can(persona, "case.run") && d.status !== "approved";
  const creditedSum = useMemo(() => d.lines.reduce((a, l) => a + l.creditCents, 0), [d.lines]);

  const act = useCallback(async (fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok ? { kind: "ok", text: okText } : { kind: "error", text: String(r.data.error ?? "Refused") });
      if (r.ok) router.refresh();
      return r;
    } finally {
      setBusy(false);
    }
  }, [router]);

  const approve = useCallback(() => {
    if (!view.gate.enabled || busy) return;
    void act(() => post(`/api/cases/${view.ticket.id}/approve`, {}), "Approved. The writes are on the Systems page.");
  }, [view.gate.enabled, view.ticket.id, act, busy]);

  // Keyboard shortcuts: j/k move through the timeline, a approves when the button would be enabled.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = shortcutAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target as HTMLElement | null }, view.gate.enabled && !busy);
      if (!action) return;
      e.preventDefault();
      if (action === "approve") return approve();
      const seqs = view.rows.map((r) => r.checkpoint.seq);
      setSelected((cur) => {
        const i = Math.max(0, seqs.indexOf(cur));
        return seqs[Math.min(seqs.length - 1, Math.max(0, i + (action === "next" ? 1 : -1)))] ?? cur;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.gate.enabled, view.rows, busy, approve]);

  async function saveReply() {
    setReplyViolations([]);
    const r = await act(() => post(`/api/cases/${view.ticket.id}/reply`, { reply }), "Reply saved.");
    if (!r.ok) setReplyViolations(((r.data.violations as { kind: string; detail: string }[]) ?? []).map((v) => `${v.kind.replaceAll("_", " ")}: ${v.detail}`));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.2fr)_minmax(0,1.15fr)]" data-testid="case-view">
      {/* Ticket */}
      <aside className="space-y-3" aria-label="Ticket">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Ticket {view.ticket.id} · {ageLabel(view.ticket.ageHours)} old</p>
          <h1 className="text-lg font-semibold leading-tight">{view.ticket.subject}</h1>
        </div>
        <div className="rounded border border-[var(--line)] bg-[var(--card)] p-3 text-sm leading-relaxed" data-testid="ticket-text">
          {view.ticket.segments.map((s, i) => s.hit ? <mark key={i} data-testid="grievance" className="rounded bg-yellow-200 px-0.5 text-stone-900">{s.text}</mark> : <span key={i}>{s.text}</span>)}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-[var(--muted)]">Customer</dt><dd>{view.account.name}</dd>
          <dt className="text-[var(--muted)]">Plan</dt><dd className="capitalize">{view.account.plan}</dd>
          <dt className="text-[var(--muted)]">Tenure</dt><dd>{view.account.tenureDays} days</dd>
          <dt className="text-[var(--muted)]">Prior disputes</dt><dd>{view.account.priorDisputes}</dd>
          <dt className="text-[var(--muted)]">Session</dt><dd>{view.session?.id ?? "none"} · {usd(view.session?.totalCostCents ?? 0)}</dd>
          <dt className="text-[var(--muted)]">Dispute</dt><dd>{view.ticket.disputeThreatened ? <span className="font-medium text-red-700 dark:text-red-300">chargeback threatened</span> : "none"}</dd>
        </dl>
        {d.injectionDetected && (
          <p role="note" data-testid="injection-flag" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            This Ticket contains an instruction aimed at the pricing system. It was flagged and ignored: Credit comes only from Labels and policy.
          </p>
        )}
      </aside>

      {/* Timeline + evidence */}
      <section className="space-y-3" aria-label="Session timeline">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Session timeline <span className="font-normal text-[var(--muted)]">({view.rows.length} Checkpoints)</span></h2>
          <p data-testid="shortcut-help" className="text-xs text-[var(--muted)]">
            {SHORTCUT_HELP.map((s) => <span key={s.keys} className="ml-3"><kbd className="rounded border border-[var(--line)] px-1">{s.keys}</kbd> {s.does}</span>)}
          </p>
        </div>
        <ol className="divide-y divide-[var(--line)] rounded border border-[var(--line)] bg-[var(--card)]" data-testid="timeline">
          {view.rows.map((r) => {
            const cp = r.checkpoint;
            const credit = r.line?.creditCents ?? 0;
            return (
              <li key={cp.id}>
                <button
                  type="button" onClick={() => setSelected(cp.seq)} data-testid={`timeline-row-${cp.seq}`} aria-current={cp.seq === selected}
                  className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--bg)]", cp.seq === selected && "bg-[var(--bg)] ring-1 ring-inset ring-[var(--accent)]", r.excluded && "opacity-60")}
                >
                  <span className="w-5 shrink-0 pt-0.5 text-xs tabular-nums text-[var(--muted)]">{cp.seq}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ModeBadge mode={cp.mode} />
                      {r.excluded ? (
                        <span data-testid="free-mode-tag" className="text-xs text-[var(--muted)]">free mode, excluded from Credit</span>
                      ) : r.label ? (
                        <><LabelChip label={r.label.label} /><SourceBadge source={r.label.source} /></>
                      ) : (
                        <span data-testid="unresolved-chip" className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-200">needs a human</span>
                      )}
                      {r.label?.note && <span data-testid="label-note" className="text-xs text-[var(--muted)]">{r.label.note}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[var(--muted)]">{cp.requestText}</span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block">{usd(cp.costCents)}</span>
                    {credit > 0 && <span className="block text-xs font-medium text-rose-700 dark:text-rose-300">credit {usd(credit)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {row && (
          <div data-testid="evidence-drawer" role="complementary" aria-label={`Evidence for Checkpoint ${row.checkpoint.seq}`} className="rounded border border-[var(--line)] bg-[var(--card)] p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Checkpoint {row.checkpoint.seq}</h3>
              {row.label && !row.excluded && <LabelChip label={row.label.label} />}
              {row.label && <span className="text-xs text-[var(--muted)]">{row.label.source === "rule" ? "decided by rule" : row.label.source === "human" ? "decided by a person" : `model, confidence ${row.label.confidence}`}</span>}
            </div>
            {row.label?.humanPrompt && <p data-testid="human-prompt" className="mb-2 rounded bg-violet-50 p-2 text-violet-950 dark:bg-violet-950 dark:text-violet-100">{row.label.humanPrompt}</p>}
            {row.unresolved && !row.label && <p data-testid="human-prompt" className="mb-2 rounded bg-violet-50 p-2 text-violet-950 dark:bg-violet-950 dark:text-violet-100">No rule or model settled this Checkpoint. Choose a Label and give a reason.</p>}
            {row.label?.alsoMatched && row.label.alsoMatched.length > 0 && <p className="mb-2 text-xs text-[var(--muted)]">Also matched, lost on precedence: {row.label.alsoMatched.map((l) => LABEL_TEXT[l]).join(", ")}</p>}
            <dl className="space-y-1">
              {row.evidence.map((e) => (
                <div key={e.field} data-testid="evidence-row" data-field={e.field} data-cited={e.cited} className={cn("grid grid-cols-[7rem_1fr] gap-2 rounded px-1.5 py-1", e.cited ? "bg-yellow-100 ring-1 ring-yellow-400 dark:bg-yellow-950 dark:ring-yellow-700" : "text-[var(--muted)]")}>
                  <dt className="text-xs uppercase tracking-wide">{e.label}</dt>
                  <dd className="break-words">{e.value}</dd>
                </div>
              ))}
            </dl>
            {row.label?.claims && row.label.claims.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs" data-testid="claims">
                {row.label.claims.map((c, i) => <li key={i}><span className="font-medium">{c.status}</span>: {c.claim} <span className="text-[var(--muted)]">({c.evidence})</span></li>)}
              </ul>
            )}
            {canOverride && !row.excluded && (
              <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--line)] pt-3" onSubmit={(e) => { e.preventDefault(); void act(() => post(`/api/cases/${view.ticket.id}/override`, { kind: "label", checkpointId: row.checkpoint.id, to: labelChoice, reason: labelReason }), "Label overridden; the Decision was re-priced."); }}>
                <label className="text-xs">Label
                  <select data-testid="override-label" value={labelChoice} onChange={(e) => setLabelChoice(e.target.value as Label)} className="ml-1 rounded border border-[var(--line)] bg-[var(--bg)] px-1 py-1 text-sm">
                    {LABELS.map((l) => <option key={l} value={l}>{LABEL_TEXT[l]}</option>)}
                  </select>
                </label>
                <label className="min-w-40 flex-1 text-xs">Reason (required)
                  <input data-testid="override-label-reason" value={labelReason} onChange={(e) => setLabelReason(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm" />
                </label>
                <button disabled={busy} data-testid="override-label-submit" className="rounded border border-[var(--line)] px-2 py-1 text-sm hover:bg-[var(--bg)] disabled:opacity-50">Override</button>
              </form>
            )}
          </div>
        )}
      </section>

      {/* Decision */}
      <aside className="space-y-3" aria-label="Decision">
        <div data-testid="status-banner" data-status={status} className={cn("rounded border p-3", banner.tone)}>
          <p className="font-semibold">{banner.title}{d.status === "approved" && d.approver ? ` by ${d.approver}` : ""}</p>
          {d.priorCredit && <p className="text-sm">This Session was already credited {usd(d.priorCredit.amountCents)} on {d.priorCredit.approvedOn}. No second Credit is added.</p>}
          {d.status === "needs_lead" && <p className="text-sm">{d.capStatus === "chargeback_bump" || d.capStatus === "bump_clamped" ? "A Chargeback bump raised the ceiling; a Lead must approve." : "The proposal was clamped to the Cap Headroom; a Lead must approve."}</p>}
          {d.status === "needs_human" && <p className="text-sm">{d.unresolved.length + d.lines.filter((l) => l.needsHuman).length > 0 ? "Some Checkpoints are flagged. Override each with a Label and a reason." : "See the notes below."}</p>}
          {d.status === "recommend_only" && <p className="text-sm">Enterprise Credits are decided by the account manager. Nothing can be written from here.</p>}
        </div>

        <div className="rounded border border-[var(--line)] bg-[var(--card)] p-3">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{d.status === "recommend_only" ? "Recommended Credit" : "Proposed Credit"}</p>
          <p data-testid="decision-amount" className="text-3xl font-semibold tabular-nums">{usd(d.amountCents)}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Clauses cited: {d.clauses.length ? d.clauses.join(", ") : "none"} · policy {d.policyVersion} (draft numbers)</p>
          <ul className="mt-1 space-y-0.5 text-xs text-[var(--muted)]">
            {d.clauses.map((c) => <li key={c}><span className="font-medium text-[var(--fg)]">{c}</span> {view.clauseText[c]}</li>)}
          </ul>
        </div>

        <CapMeter cap={view.cap} />

        <div className="rounded border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full text-sm" data-testid="credit-lines">
            <thead className="text-left text-xs text-[var(--muted)]"><tr><th className="px-3 py-1.5">#</th><th>Label</th><th>Clause</th><th className="text-right">Cost</th><th className="px-3 text-right">Credit</th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.checkpointId} data-testid="credit-line" className={cn("border-t border-[var(--line)]", l.creditCents === 0 && "text-[var(--muted)]")}>
                  <td className="px-3 py-1 tabular-nums">{l.seq}</td>
                  <td>{LABEL_TEXT[l.label]}</td><td>{l.clause ?? "—"}</td>
                  <td className="text-right tabular-nums">{usd(l.costCents)}</td>
                  <td className="px-3 text-right tabular-nums">{usd(l.creditCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line)] font-semibold">
                <td className="px-3 py-1.5" colSpan={4}>Lines sum to total</td>
                <td data-testid="lines-total" className="px-3 text-right tabular-nums">{usd(creditedSum)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {d.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="notes">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

        <div className="rounded border border-[var(--line)] bg-[var(--card)] p-3">
          <label className="text-sm font-medium" htmlFor="reply">Reply to the customer</label>
          <textarea id="reply" data-testid="reply-textarea" value={reply} onChange={(e) => setReply(e.target.value)} readOnly={!canOverride} rows={11} className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] p-2 text-sm leading-relaxed" placeholder={d.reply === null ? "No draft passed validation. A person must write the reply." : ""} />
          {replyViolations.length > 0 && <ul data-testid="reply-violations" className="mt-1 list-disc pl-5 text-sm text-red-700 dark:text-red-300">{replyViolations.map((v) => <li key={v}>{v}</li>)}</ul>}
          {canOverride && <button data-testid="save-reply" disabled={busy || reply === (d.reply ?? "")} onClick={saveReply} className="mt-2 rounded border border-[var(--line)] px-2 py-1 text-sm hover:bg-[var(--bg)] disabled:opacity-50">Save reply</button>}
        </div>

        {canOverride && d.ceilingCents !== null && (
          <form className="flex flex-wrap items-end gap-2 rounded border border-[var(--line)] bg-[var(--card)] p-3" onSubmit={(e) => { e.preventDefault(); void act(() => post(`/api/cases/${view.ticket.id}/override`, { kind: "amount", to: Math.round(Number(amount) * 100), reason: amountReason }), "Amount overridden."); }}>
            <label className="text-xs">Set amount ($, up to {usd(d.ceilingCents)})
              <input data-testid="override-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-0.5 block w-28 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm" />
            </label>
            <label className="min-w-32 flex-1 text-xs">Reason (required)
              <input data-testid="override-amount-reason" value={amountReason} onChange={(e) => setAmountReason(e.target.value)} className="mt-0.5 block w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm" />
            </label>
            <button disabled={busy || amount === ""} className="rounded border border-[var(--line)] px-2 py-1 text-sm hover:bg-[var(--bg)] disabled:opacity-50">Override amount</button>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button data-testid="approve-button" onClick={approve} disabled={!view.gate.enabled || busy} title={view.gate.reason} className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
            Approve {usd(d.amountCents)}
          </button>
          {canRun && (["sim-a", "sim-b"] as const).map((m) => (
            <button key={m} disabled={busy} onClick={() => act(() => post(`/api/cases/${view.ticket.id}/run`, { model: m }), `Re-ran with ${m === "sim-a" ? "Simulated model A" : "Simulated model B"}.`)} className="rounded border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--bg)] disabled:opacity-50">
              Re-run with model {m === "sim-a" ? "A" : "B"}
            </button>
          ))}
        </div>
        {!view.gate.enabled && view.gate.reason && <p data-testid="gate-reason" className="text-sm text-[var(--muted)]">{view.gate.reason}</p>}
        <p role="status" aria-live="polite" data-testid="message" className={cn("min-h-5 text-sm", msg?.kind === "error" && "text-red-700 dark:text-red-300", msg?.kind === "ok" && "text-emerald-700 dark:text-emerald-300")}>{msg?.text}</p>
        <p className="text-xs text-[var(--muted)]">Model {d.modelName} · prompts {d.promptVersion} · simulated cost ${d.costUsd.toFixed(4)} · simulated latency {(d.latencyMs / 1000).toFixed(1)}s</p>
      </aside>
    </div>
  );
}

function CapMeter({ cap }: { cap: View["cap"] }) {
  if (cap.capCents === null) {
    return <div data-testid="cap-meter" className="rounded border border-[var(--line)] bg-[var(--card)] p-3 text-sm">Enterprise plan: no Cap applies. The amount is a recommendation for the account manager.</div>;
  }
  const scale = Math.max(cap.bumpedCapCents ?? cap.capCents, cap.grantedCents + cap.proposedCents, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  return (
    <div data-testid="cap-meter" className="rounded border border-[var(--line)] bg-[var(--card)] p-3">
      <div className="flex justify-between text-xs"><span className="capitalize">{cap.plan} Cap, 30 days</span><span className="tabular-nums">{usd(cap.capCents)}</span></div>
      <div className="relative mt-1 h-3 overflow-hidden rounded bg-[var(--bg)] ring-1 ring-[var(--line)]" role="img" aria-label={`Already credited ${usd(cap.grantedCents)}, proposed ${usd(cap.proposedCents)}, Cap ${usd(cap.capCents)}`}>
        <div className="absolute inset-y-0 left-0 bg-stone-400" style={{ width: pct(cap.grantedCents) }} />
        <div className="absolute inset-y-0 bg-[var(--accent)]" style={{ left: pct(cap.grantedCents), width: pct(cap.proposedCents) }} />
        <div className="absolute inset-y-0 w-0.5 bg-red-600" style={{ left: pct(cap.capCents) }} title="Cap" />
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">Already credited {usd(cap.grantedCents)} · Headroom {usd(cap.headroomCents ?? 0)} · highest approvable {usd(cap.ceilingCents ?? 0)}</p>
    </div>
  );
}
