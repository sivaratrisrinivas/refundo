import { SimulatedModel } from "./simulated";
import type { ModelName, ModelProvider } from "./types";

export * from "./types";
export { redactSecrets, redactDeep, REDACTED } from "./redact";
export { getProfile } from "./profiles";

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
