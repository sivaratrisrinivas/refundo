"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function reset() {
    setBusy(true);
    const res = await fetch("/api/demo/reset", { method: "POST" });
    setMsg(res.ok ? "Demo reset to the seeded state." : "Reset refused for this Persona.");
    setBusy(false);
    if (res.ok) router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button data-testid="reset-demo" disabled={busy} onClick={reset} className="rounded border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-[var(--card)] disabled:opacity-50">
        Reset demo
      </button>
      <span role="status" className="text-sm text-[var(--muted)]">{msg}</span>
    </span>
  );
}
