# All models are simulated

The owner has no API keys or credits, so every LLM step in the pipeline (complaint extraction, claim verification, labeling, clause selection, reply drafting) runs against two simulated models, A (strong) and B (cheap). Each has a declared, seeded error profile in a committed file that never reads the expected answers. Free text (request text, agent claims, ticket bodies) is authored by hand and committed, not generated at runtime. The reply drafter is a template engine, and model B injects defects (a cash promise, a missing line) so the reply validator is exercised. Cost and latency come from token counts times an illustrative price table.

Consequently no eval number is a measurement of a real model. The headline result is that the validators, rules and engine contain simulated-model mistakes, and the UI and README say so. The plan's LLM judge for reply checks is dropped, because a judge cannot be validated without a real model.

## Considered Options

- Oracle models that echo the expected answers: the eval would then prove nothing.
- Real providers only: nothing would run without keys.

## Consequences

A real-provider adapter can later be added behind the same interface, but no claim about a real model may be made until real runs exist.
