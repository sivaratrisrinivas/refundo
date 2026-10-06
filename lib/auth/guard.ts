import { readViewer } from "./cookies";
import { can, type Action, type Persona } from "./personas";

export type GuardResult =
  | { ok: true; persona: Persona }
  | { ok: false; response: Response };

/**
 * Server-side role check for every API route. Disabling a button in the
 * browser is never the control: this is.
 */
export function guard(request: Request, action: Action): GuardResult {
  const viewer = readViewer(request.headers.get("cookie"));
  if (!viewer.authed) {
    return { ok: false, response: Response.json({ error: "passcode required" }, { status: 401 }) };
  }
  if (!can(viewer.persona, action)) {
    return {
      ok: false,
      response: Response.json(
        { error: `${viewer.persona} may not ${action}` },
        { status: 403 },
      ),
    };
  }
  return { ok: true, persona: viewer.persona };
}
