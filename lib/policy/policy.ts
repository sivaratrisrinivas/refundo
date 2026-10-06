import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { LABELS, type ClauseId, type Label } from "./types";

const clauseSchema = z.object({
  label: z.enum(LABELS),
  credit_pct: z.number().min(0).max(100),
  window_min: z.number().positive().optional(),
  credit_from_repeat: z.number().int().positive().optional(),
  files_ratio: z.number().positive().optional(),
  needs_human: z.boolean().optional(),
  file_linear: z.boolean().optional(),
});

const rawSchema = z.object({
  version: z.string().min(1),
  draft_numbers: z.boolean(),
  clauses: z.record(z.string(), clauseSchema),
  caps_30d_usd: z.object({ core: z.number(), pro: z.number() }),
  enterprise: z.literal("route_to_account_manager"),
  chargeback_bump: z.object({ max_multiplier: z.number().min(1), needs_lead_approval: z.boolean() }),
  min_confidence: z.number().min(0).max(1),
  credit_form: z.string(),
  median_files: z.object({
    style: z.number(),
    fix: z.number(),
    feature: z.number(),
    refactor: z.number(),
  }),
});

export interface ClauseRule {
  id: ClauseId;
  label: Label;
  creditPct: number;
  windowMin?: number;
  creditFromRepeat?: number;
  filesRatio?: number;
  needsHuman: boolean;
  fileLinear: boolean;
}

export type RequestClass = "style" | "fix" | "feature" | "refactor";

export interface Policy {
  version: string;
  draftNumbers: boolean;
  clauses: Record<ClauseId, ClauseRule>;
  capsCents: { core: number; pro: number };
  chargebackMaxMultiplier: number;
  chargebackNeedsLead: boolean;
  minConfidence: number;
  creditForm: string;
  medianFiles: Record<RequestClass, number>;
}

const CLAUSE_IDS: ClauseId[] = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];

export function parsePolicy(yamlText: string): Policy {
  const raw = rawSchema.parse(parse(yamlText));
  const clauses = {} as Record<ClauseId, ClauseRule>;
  for (const id of CLAUSE_IDS) {
    const c = raw.clauses[id];
    if (!c) throw new Error(`policy is missing clause ${id}`);
    clauses[id] = {
      id,
      label: c.label,
      creditPct: c.credit_pct,
      windowMin: c.window_min,
      creditFromRepeat: c.credit_from_repeat,
      filesRatio: c.files_ratio,
      needsHuman: c.needs_human ?? false,
      fileLinear: c.file_linear ?? false,
    };
  }
  return {
    version: raw.version,
    draftNumbers: raw.draft_numbers,
    clauses,
    capsCents: {
      core: Math.round(raw.caps_30d_usd.core * 100),
      pro: Math.round(raw.caps_30d_usd.pro * 100),
    },
    chargebackMaxMultiplier: raw.chargeback_bump.max_multiplier,
    chargebackNeedsLead: raw.chargeback_bump.needs_lead_approval,
    minConfidence: raw.min_confidence,
    creditForm: raw.credit_form,
    medianFiles: raw.median_files,
  };
}

let cached: Policy | undefined;

/** The committed policy file, parsed once. */
export function loadPolicy(): Policy {
  cached ??= parsePolicy(readFileSync(join(process.cwd(), "lib/policy/policy.yaml"), "utf8"));
  return cached;
}

/** Which Clause a Label maps to. `unknown` has none; planning rides C1. */
export function clauseForLabel(label: Label): ClauseId | null {
  switch (label) {
    case "delivered":
    case "planning":
      return "C1";
    case "reverted_after_fail":
      return "C2";
    case "loop":
      return "C3";
    case "false_completion":
      return "C4";
    case "scope_overrun":
      return "C5";
    case "incident_overlap":
      return "C6";
    case "known_bug":
      return "C7";
    case "user_choice_rollback":
      return "C8";
    case "unknown":
      return null;
  }
}
