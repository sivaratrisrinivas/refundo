import { SimulatedModel } from "./simulated";
import { getProfile, type Profile } from "./profiles";
import type { ModelName, ModelProvider } from "./types";

export * from "./types";
export { redactSecrets, redactDeep, REDACTED } from "./redact";
export { getProfile } from "./profiles";
export { SimulatedModel } from "./simulated";

const providers = new Map<ModelName, ModelProvider>();

/** The only providers are the two Simulated models (ADR 0002). */
export function getProvider(name: ModelName): ModelProvider {
  let p = providers.get(name);
  if (!p) {
    p = new SimulatedModel(name);
    providers.set(name, p);
  }
  return p;
}

/** A Simulated model with every error rate at zero: for testing pipeline logic in isolation. */
export function errorFreeModel(name: ModelName): ModelProvider {
  const p = getProfile(name);
  const zero = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.keys(o).map((k) => [k, 0])) as T;
  const clean: Profile = {
    ...p,
    complaint: zero(p.complaint), label: zero(p.label), verify: zero(p.verify), clauses: zero(p.clauses), reply: zero(p.reply),
  };
  return new SimulatedModel(name, clean);
}
