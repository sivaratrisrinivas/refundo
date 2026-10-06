"use client";

import { useRouter } from "next/navigation";
import { PERSONAS, PERSONA_LABEL, type Persona } from "@/lib/auth/personas";

export function PersonaSwitcher({ current }: { current: Persona }) {
  const router = useRouter();
  async function choose(persona: Persona) {
    await fetch("/api/persona", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona }),
    });
    router.refresh();
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--muted)]">Acting as</span>
      <select
        data-testid="persona-switcher"
        value={current}
        onChange={(e) => choose(e.target.value as Persona)}
        className="rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1"
      >
        {PERSONAS.map((p) => (
          <option key={p} value={p}>
            {PERSONA_LABEL[p]}
          </option>
        ))}
      </select>
    </label>
  );
}
