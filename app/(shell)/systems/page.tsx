import { cookies } from "next/headers";
import { ResetDemoButton } from "@/components/ResetDemoButton";
import { PERSONA_COOKIE } from "@/lib/auth/cookies";
import { can, isPersona } from "@/lib/auth/personas";
import { appDb } from "@/lib/db/app-db";
import { listOutbox, type OutboxRow } from "@/lib/db/systems";

export const dynamic = "force-dynamic";

function Entry({ row, children }: { row: OutboxRow; children: React.ReactNode }) {
  return (
    <li data-testid="outbox-entry" data-system={row.system} className="rounded border border-[var(--line)] bg-[var(--card)] p-3 text-sm">
      <div className="flex justify-between gap-3">
        <div className="min-w-0">{children}</div>
        <time className="shrink-0 text-xs text-[var(--muted)]">{row.createdAt.slice(0, 16).replace("T", " ")}Z</time>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-[var(--muted)]">Raw payload ({row.decisionId})</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-[var(--bg)] p-2 text-xs">{JSON.stringify(row.payload, null, 2)}</pre>
      </details>
    </li>
  );
}

type Orb = { endpoint: string; body: { entry_type: string; amount: number; per_unit_cost_basis?: string; metadata?: { session_id: string; clause_ids: string[] } } };
type Zd = { endpoint: string; body: { ticket: { tags: string[]; status: string; comment: { body: string } } } };
type Lin = { body: { variables: { input: { title: string; description: string; labelNames: string[] } } } };

export default async function SystemsPage() {
  const raw = (await cookies()).get(PERSONA_COOKIE)?.value;
  const persona = isPersona(raw) ? raw : "specialist";
  const db = appDb();
  const orb = listOutbox(db, "orb");
  const zd = listOutbox(db, "zendesk");
  const lin = listOutbox(db, "linear");
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Systems</h1>
          <p className="text-sm text-[var(--muted)]">Mock Orb, Zendesk and Linear. Newest first. Writes land here when a Case is approved.</p>
        </div>
        {can(persona, "demo.reset") ? <ResetDemoButton /> : <span className="text-sm text-[var(--muted)]">Reset demo is for Lead and Reviewer.</span>}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Orb ledger <span className="font-normal text-[var(--muted)]">({orb.length})</span></h2>
          <ul className="space-y-2" data-testid="orb-list">
            {orb.length === 0 && <li className="text-sm text-[var(--muted)]">No ledger entries yet.</li>}
            {orb.map((r) => { const p = r.payload as Orb; return (
              <Entry key={r.id} row={r}>
                <p className="font-medium">{p.body.entry_type} · ${p.body.amount.toFixed(2)}</p>
                <p className="text-xs text-[var(--muted)]">{p.endpoint.replace("POST ", "")}</p>
                <p className="text-xs">cost basis {p.body.per_unit_cost_basis ?? "n/a"} · {p.body.metadata?.session_id} · {p.body.metadata?.clause_ids.join(", ")}</p>
              </Entry>
            ); })}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Zendesk outbox <span className="font-normal text-[var(--muted)]">({zd.length})</span></h2>
          <ul className="space-y-2" data-testid="zendesk-list">
            {zd.length === 0 && <li className="text-sm text-[var(--muted)]">No ticket updates yet.</li>}
            {zd.map((r) => { const p = r.payload as Zd; return (
              <Entry key={r.id} row={r}>
                <p className="font-medium">{p.endpoint.replace("PUT ", "")} · {p.body.ticket.status}</p>
                <p className="text-xs">tags: {p.body.ticket.tags.join(", ")}</p>
                <p className="mt-1 line-clamp-3 text-xs text-[var(--muted)]">{p.body.ticket.comment.body}</p>
              </Entry>
            ); })}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Linear issues <span className="font-normal text-[var(--muted)]">({lin.length})</span></h2>
          <ul className="space-y-2" data-testid="linear-list">
            {lin.length === 0 && <li className="text-sm text-[var(--muted)]">No issues yet. A known-bug match files one.</li>}
            {lin.map((r) => { const p = (r.payload as Lin).body.variables.input; return (
              <Entry key={r.id} row={r}>
                <p className="font-medium">{p.title}</p>
                <p className="text-xs">labels: {p.labelNames.join(", ")}</p>
                <p className="mt-1 whitespace-pre-line text-xs text-[var(--muted)]">{p.description}</p>
              </Entry>
            ); })}
          </ul>
        </div>
      </div>
    </section>
  );
}
