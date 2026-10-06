import { guard } from "@/lib/auth/guard";
import { appDb } from "@/lib/db/app-db";
import { listOutbox } from "@/lib/db/systems";
import { validateMockPayload } from "@/lib/mocks/payloads";

/** Mock Linear issues: the recorded writes, newest first. */
export async function GET(request: Request) {
  const g = guard(request, "systems.read");
  if (!g.ok) return g.response;
  return Response.json({ system: "linear", simulated: true, entries: listOutbox(appDb(), "linear") });
}

/** Validates a payload's shape and rejects malformed ones. It records nothing: only Approval writes. */
export async function POST(request: Request) {
  const g = guard(request, "systems.read");
  if (!g.ok) return g.response;
  const payload = await request.json().catch(() => null);
  const v = validateMockPayload("linear", payload);
  return v.ok ? Response.json({ valid: true }) : Response.json({ valid: false, error: v.error }, { status: 422 });
}
