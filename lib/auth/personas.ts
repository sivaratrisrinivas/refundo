export const PERSONAS = ["specialist", "lead", "reviewer"] as const;
export type Persona = (typeof PERSONAS)[number];

export const ACTIONS = [
  "case.view",
  "case.run",
  "decision.override",
  "decision.approve",
  "decision.approve_lead",
  "audit.read",
  "systems.read",
  "eval.read",
  "demo.reset",
] as const;
export type Action = (typeof ACTIONS)[number];

const common: Action[] = ["case.view", "systems.read", "eval.read"];

const grants: Record<Persona, ReadonlySet<Action>> = {
  specialist: new Set<Action>([
    ...common,
    "case.run",
    "decision.override",
    "decision.approve",
  ]),
  lead: new Set<Action>([
    ...common,
    "case.run",
    "decision.override",
    "decision.approve",
    "decision.approve_lead",
    "audit.read",
    "demo.reset",
  ]),
  reviewer: new Set<Action>([...common, "audit.read", "demo.reset"]),
};

export function can(persona: Persona, action: Action): boolean {
  return grants[persona].has(action);
}

export function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && (PERSONAS as readonly string[]).includes(value);
}

export const PERSONA_LABEL: Record<Persona, string> = {
  specialist: "Specialist",
  lead: "Lead",
  reviewer: "Reviewer",
};

export const DEFAULT_PERSONA: Persona = "specialist";

/** The Persona in a cookie value, or the default when it is missing or unknown. */
export function personaOrDefault(raw: unknown): Persona {
  return isPersona(raw) ? raw : DEFAULT_PERSONA;
}
