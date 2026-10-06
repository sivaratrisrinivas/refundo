import type { Label } from "@/lib/policy/types";

/** Pure display text, safe to import from client components. */
export const LABEL_TEXT: Record<Label, string> = {
  delivered: "Delivered", reverted_after_fail: "Reverted after failed test", loop: "Loop", false_completion: "False completion",
  scope_overrun: "Scope overrun", incident_overlap: "Incident overlap", known_bug: "Known bug",
  user_choice_rollback: "User-choice rollback", planning: "Planning", unknown: "Unknown",
};
