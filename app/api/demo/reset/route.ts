import { guard } from "@/lib/auth/guard";
import { resetDemo } from "@/lib/data/seed";
import { appDb } from "@/lib/db/app-db";

/** Reseeds the data and clears the outbox and audit rows made since. Lead and Reviewer only. */
export async function POST(request: Request) {
  const g = guard(request, "demo.reset");
  if (!g.ok) return g.response;
  resetDemo(appDb());
  return Response.json({ ok: true, reset: true });
}
