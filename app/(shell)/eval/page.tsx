import { latestReports } from "@/lib/eval/report";
import { metricRows, sessionRows, cents } from "@/lib/eval/view";
import type { EvalReport } from "@/lib/eval/types";
import type { ModelName } from "@/lib/models";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

const STATUS_STYLE = {
  met: "text-emerald-800 dark:text-emerald-300",
  missed: "font-semibold text-amber-800 dark:text-amber-300",
  "hard-fail": "font-semibold text-red-700 dark:text-red-300",
  reported: "",
} as const;
const STATUS_TEXT = { met: "met", missed: "target missed", "hard-fail": "HARD FAIL", reported: "reported" } as const;
const MODELS: ModelName[] = ["sim-a", "sim-b"];
const NAME: Record<ModelName, string> = { "sim-a": "Simulated model A (strong)", "sim-b": "Simulated model B (cheap)" };

function Provenance({ r }: { r: EvalReport }) {
  return (
    <p className="text-xs text-[var(--muted)]" data-testid={`provenance-${r.model}`}>
      {r.model} · run {r.runAt.slice(0, 16).replace("T", " ")}Z · seed {r.seed} · prompts {r.promptVersion} · <span className="font-medium">simulated</span>
    </p>
  );
}

export default function EvalPage() {
  const reports = latestReports();
  const have = MODELS.filter((m) => reports[m]);
  if (have.length === 0) {
    return (
      <section className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">Eval</h1>
        <p data-testid="no-report" className="mt-2 text-sm text-[var(--muted)]">
          No eval report has been stored yet, so there are no figures to show. Run <code>bun run eval -- --model A</code> and <code>bun run eval -- --model B</code>.
        </p>
      </section>
    );
  }
  const rows = metricRows(reports);
  const sessions = sessionRows(reports);
  const rerun = reports["sim-b"]?.checks.modelRerun ?? reports["sim-a"]?.checks.modelRerun;
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Eval: Simulated model A against Simulated model B</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]" data-testid="eval-disclaimer">
          Every figure on this page is <strong>simulated, not a real-model measurement</strong>. It shows how well the guardrails (validators, rules and the pricing engine) contain the mistakes of two Simulated models with declared error profiles. Cost comes from an illustrative price table and latency is recorded from a declared distribution, neither is real.
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-[var(--line)] bg-[var(--card)]">
        <table className="w-full text-sm" data-testid="metrics-table">
          <thead className="text-left text-xs text-[var(--muted)]">
            <tr><th className="px-3 py-2">Metric</th><th>Target</th>{have.map((m) => <th key={m} className="px-3">{NAME[m]}<br />{reports[m] && <Provenance r={reports[m]!} />}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-[var(--line)]" data-testid={`metric-${row.key}`}>
                <td className="px-3 py-2 font-medium">{row.label}</td>
                <td className="text-[var(--muted)]">{row.target}</td>
                {have.map((m) => { const c = row.cells[m]; return (
                  <td key={m} className="px-3 tabular-nums" data-status={c?.status}>
                    <span className={cn(c && STATUS_STYLE[c.status])}>{c?.text}</span>{" "}
                    {c && c.status !== "reported" && <span className={cn("text-xs", c && STATUS_STYLE[c.status])}>[{STATUS_TEXT[c.status]}]</span>}
                    <span className="ml-1 text-[10px] uppercase text-[var(--muted)]">simulated</span>
                  </td>
                ); })}
              </tr>
            ))}
            {rerun && (
              <tr className="border-t border-[var(--line)]" data-testid="metric-rerun">
                <td className="px-3 py-2 font-medium">Second-model rerun</td><td className="text-[var(--muted)]">within {rerun.maxGapPoints} points</td>
                <td className="px-3" colSpan={have.length}>{rerun.detail}: gap {rerun.gapPoints} points <span className={rerun.pass ? "text-emerald-800 dark:text-emerald-300" : "font-semibold text-amber-800 dark:text-amber-300"}>[{rerun.pass ? "met" : "target missed"}]</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {have.map((m) => {
        const r = reports[m]!;
        return (
          <p key={m} className="text-xs text-[var(--muted)]">
            {NAME[m]}: reply validator on a labeled set of {r.validator.bad} bad and {r.validator.good} good replies, true positive rate {(r.validator.truePositiveRate * 100).toFixed(0)}%, true negative rate {(r.validator.trueNegativeRate * 100).toFixed(0)}% (simulated replies).
            {r.hardFailures.length > 0 && <strong className="text-red-700 dark:text-red-300"> Hard failures: {r.hardFailures.join("; ")}.</strong>}
          </p>
        );
      })}

      <div>
        <h2 className="mb-2 text-sm font-semibold">The 20 Graded sessions: expected against actual <span className="font-normal text-[var(--muted)]">(simulated)</span></h2>
        <ul className="divide-y divide-[var(--line)] rounded border border-[var(--line)] bg-[var(--card)]" data-testid="sessions">
          {sessions.map((s) => (
            <li key={s.caseId} data-testid={`session-${s.caseId}`}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="w-10 font-mono text-xs">{s.caseId}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {have.map((m) => { const r = s.results[m]; return r ? (
                    <span key={m} className="w-44 text-xs tabular-nums" data-testid={`result-${s.caseId}-${m}`} data-pass={r.pass}>
                      <span className={r.pass ? "text-emerald-800 dark:text-emerald-300" : "font-semibold text-red-700 dark:text-red-300"}>{r.pass ? "pass" : "fail"}</span>{" "}
                      {m === "sim-a" ? "A" : "B"}: {cents(r.actualAmountCents)} <span className="text-[var(--muted)]">/ {cents(r.expectedAmountCents)}</span>
                    </span>
                  ) : null; })}
                </summary>
                <div className="grid gap-3 border-t border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs md:grid-cols-2">
                  {have.map((m) => { const r = s.results[m]; return r ? (
                    <div key={m}>
                      <p className="mb-1 font-medium">{NAME[m]}: status expected {r.expectedStatus}, actual {r.actualStatus}</p>
                      <table className="w-full">
                        <thead className="text-left text-[var(--muted)]"><tr><th>#</th><th>Expected</th><th>Actual</th><th>By</th></tr></thead>
                        <tbody>
                          {r.checkpoints.map((c) => (
                            <tr key={c.seq} className={cn(!c.ok && "font-semibold text-red-700 dark:text-red-300")}><td>{c.seq}</td><td>{c.expectedLabel}</td><td>{c.actualLabel}</td><td>{c.actualSource ?? "none"}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      {r.notes.length > 0 && <p className="mt-1 text-[var(--muted)]">{r.notes[0]}</p>}
                    </div>
                  ) : null; })}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
