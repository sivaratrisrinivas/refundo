import { NextResponse } from "next/server";
import { PERSONA_COOKIE, readViewer } from "@/lib/auth/cookies";
import { isPersona } from "@/lib/auth/personas";

export async function POST(request: Request) {
  if (!readViewer(request.headers.get("cookie")).authed) {
    return NextResponse.json({ error: "passcode required" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { persona?: unknown };
  if (!isPersona(body.persona)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }
  const res = NextResponse.json({ persona: body.persona });
  res.cookies.set(PERSONA_COOKIE, body.persona, { sameSite: "lax", path: "/" });
  return res;
}
