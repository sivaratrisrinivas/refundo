import { cn } from "@/lib/ui/cn";
import type { Label } from "@/lib/policy/types";
import { LABEL_TEXT } from "@/lib/pipeline/label-text";

const TONE: Record<Label, string> = {
  delivered: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  planning: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  user_choice_rollback: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200",
  reverted_after_fail: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  loop: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  false_completion: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  incident_overlap: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  known_bug: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  scope_overrun: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  unknown: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
};

export function LabelChip({ label }: { label: Label }) {
  return (
    <span data-testid="label-chip" data-label={label} className={cn("inline-flex rounded px-2 py-0.5 text-xs font-medium", TONE[label])}>
      {LABEL_TEXT[label]}
    </span>
  );
}

const SOURCE_TEXT = { rule: "rule", model: "model", human: "human" } as const;
export function SourceBadge({ source }: { source: "rule" | "model" | "human" | "none" }) {
  if (source === "none") return null;
  return (
    <span data-testid="source-badge" className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
      {SOURCE_TEXT[source]}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: "free" | "power" | "max" }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide", mode === "free" ? "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300" : "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200")}>
      {mode}
    </span>
  );
}
