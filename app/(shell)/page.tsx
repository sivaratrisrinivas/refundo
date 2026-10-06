import Link from "next/link";
import { appDb } from "@/lib/db/app-db";
import { listQueue, STATUSES, type Risk, type TicketStatus } from "@/lib/db/queue";
import { ageLabel, usd } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

const RISK_STYLE: Record<Risk, string> = {
  high: "bg-red-100 text-red-800",
  watch: "bg-amber-100 text-amber-800",
  normal: "bg-stone-100 text-stone-700",
};
const RISK_LABEL: Record<Risk, string> = { high: "chargeback risk", watch: "dispute history", normal: "standard" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as TicketStatus) ? (status as TicketStatus) : undefined;
  const rows = listQueue(appDb(), { status: filter });
  return (
    <section>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Queue</h1>
          <p className="text-sm text-[var(--muted)]">Chargeback risk first, then oldest. {rows.length} Tickets.</p>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Status filter">
          <Link href="/" className={cn("rounded px-2 py-1", !filter && "bg-[var(--accent)] text-white")}>All</Link>
          {STATUSES.map((s) => (
            <Link key={s} href={`/?status=${s}`} className={cn("rounded px-2 py-1", filter === s && "bg-[var(--accent)] text-white")}>
              {s.replace("_", " ")}
            </Link>
          ))}
        </nav>
      </div>
      <table className="mt-4 w-full text-sm" data-testid="queue">
        <thead className="text-left text-[var(--muted)]">
          <tr>
            <th className="py-2">Risk</th><th>Ticket</th><th>Customer</th><th>Plan</th>
            <th className="text-right">Disputed</th><th className="text-right">Age</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticketId} className="border-t border-[var(--line)]" data-testid="queue-row" data-risk={r.risk}>
              <td className="py-2">
                <span className={cn("rounded px-2 py-0.5 text-xs", RISK_STYLE[r.risk])}>{RISK_LABEL[r.risk]}</span>
              </td>
              <td><Link className="text-[var(--accent)] hover:underline" href={`/cases/${r.ticketId}`}>{r.subject}</Link></td>
              <td>{r.customer}</td>
              <td className="capitalize">{r.plan}</td>
              <td className="text-right tabular-nums">{usd(r.disputedCents)}</td>
              <td className="text-right tabular-nums">{ageLabel(r.ageHours)}</td>
              <td>{r.status.replace("_", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
