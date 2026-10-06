import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth/cookies";

const OPEN = ["/login", "/api/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN.some((p) => pathname === p)) return NextResponse.next();
  if (request.cookies.get(AUTH_COOKIE)?.value === authToken()) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "passcode required" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
