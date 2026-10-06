import { cookies } from "next/headers";
import { PERSONA_COOKIE } from "@/lib/auth/cookies";
import { can, isPersona } from "@/lib/auth/personas";
import { verifyAuditChain } from "@/lib/audit";
import { schema } from "@/lib/db/client";
import { appDb } from "@/lib/db/app-db";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const raw = (await cookies()).get(PERSONA_COOKIE)?.value;
  const persona = isPersona(raw) ? raw : "specialist";
  if (!can(persona, "audit.read")) {
    return (
      <section className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">Audit</h1>
        <p data-testid="audit-denied" className="mt-2 text-sm text-[var(--muted)]">The audit log is for Lead and Reviewer. Switch Persona to read it.</p>
      </section>
    );
  }
  const db = appDb();
  const rows = db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.id)).all();
  const check = verifyAuditChain(db);
  return (
    <section className="mx-auto max-w-6xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Audit</h1>
        <p data-testid="chain-status" className={check.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-red-700 dark:text-red-300"}>
          {check.ok ? `Hash chain verified: ${check.rows} rows, append-only` : `Chain broken at row ${check.brokenAtId}: ${check.reason}`}
        </p>
      </div>
      <table className="w-full text-sm" data-testid="audit-table">
        <thead className="text-left text-[var(--muted)]"><tr><th className="py-1">#</th><th>When</th><th>Actor</th><th>Action</th><th>Detail</th><th>Hash</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--line)] align-top">
              <td className="py-1.5 tabular-nums">{r.id}</td>
              <td className="whitespace-nowrap">{r.ts.slice(0, 16).replace("T", " ")}Z</td>
              <td className="capitalize">{r.actor}</td><td>{r.action}</td>
              <td className="max-w-md break-words text-xs text-[var(--muted)]">{JSON.stringify(r.payload)}</td>
              <td className="font-mono text-xs">{r.hash.slice(0, 10)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-[var(--muted)]">No audit rows yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
