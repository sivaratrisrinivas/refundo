import { guard } from "@/lib/auth/guard";

// Wired to the real reseed in the Systems-page ticket; the gate is live now.
export async function POST(request: Request) {
  const g = guard(request, "demo.reset");
  if (!g.ok) return g.response;
  return Response.json({ error: "reset not implemented yet" }, { status: 501 });
}
