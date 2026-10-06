import { NextResponse } from "next/server";
import { AUTH_COOKIE, PERSONA_COOKIE, authToken, passcode } from "@/lib/auth/cookies";

export async function POST(request: Request) {
  const form = await request.formData();
  const given = String(form.get("passcode") ?? "");
  if (given !== passcode()) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.set(AUTH_COOKIE, authToken(), { httpOnly: true, sameSite: "lax", path: "/" });
  res.cookies.set(PERSONA_COOKIE, "specialist", { sameSite: "lax", path: "/" });
  return res;
}
