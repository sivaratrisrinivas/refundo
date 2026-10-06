export type ShortcutAction = "next" | "prev" | "approve" | null;

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Maps a key press on the Case page to an action. Shortcuts are ignored while
 * typing, with a modifier held, and `a` obeys the same gate the Approve button does.
 */
export function shortcutAction(
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: { tagName?: string; isContentEditable?: boolean } | null },
  approveEnabled: boolean,
): ShortcutAction {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  if (t && ((t.tagName && TYPING.has(t.tagName.toUpperCase())) || t.isContentEditable)) return null;
  switch (e.key) {
    case "j": return "next";
    case "k": return "prev";
    case "a": return approveEnabled ? "approve" : null;
    default: return null;
  }
}

export const SHORTCUT_HELP = [
  { keys: "j / k", does: "next / previous Checkpoint" },
  { keys: "a", does: "approve (when allowed)" },
] as const;
