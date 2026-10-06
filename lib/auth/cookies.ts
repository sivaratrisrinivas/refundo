import { createHash } from "node:crypto";
import { personaOrDefault, type Persona } from "./personas";

export const AUTH_COOKIE = "refundo_auth";
export const PERSONA_COOKIE = "refundo_persona";
export const DEFAULT_PASSCODE = "refundo-demo";

export function passcode(): string {
  return process.env.REFUNDO_PASSCODE ?? DEFAULT_PASSCODE;
}

/** Demo-grade auth: the cookie is a hash of the passcode, nothing more. */
export function authToken(code: string = passcode()): string {
  return createHash("sha256").update(`refundo-gate:${code}`).digest("hex");
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface Viewer {
  authed: boolean;
  persona: Persona;
}

export function readViewer(cookieHeader: string | null | undefined): Viewer {
  const jar = parseCookies(cookieHeader);
  const authed = jar[AUTH_COOKIE] === authToken();
  const persona = personaOrDefault(jar[PERSONA_COOKIE]);
  return { authed, persona };
}
