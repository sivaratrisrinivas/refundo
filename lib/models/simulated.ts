import { getProfile, type Profile } from "./profiles";
import { pick, rngFrom } from "./rng";
import { redactDeep } from "./redact";
import {
  readClauses, readClaims, readComplaint, readLabels,
} from "./competence";
import { renderReply, type TemplateDefects } from "./reply-template";
import {
  PROMPT_VERSION,
  type CallContext, type ModelName, type ModelProvider, type ModelResult, type Task, type TaskInputs,
} from "./types";

/** Roughly the size of each task's system prompt, for token counting. */
const SYSTEM_PROMPT_TOKENS: Record<Task, number> = {
  complaint: 160, label: 420, verify: 180, clauses: 140, reply: 150,
};

const BAD_FIELDS = ["diffSummary", "stackTrace", "commitMessage", "testOutput"];
const CONFUSIONS: Record<string, string[]> = {
  delivered: ["false_completion", "unknown"],
  false_completion: ["delivered", "unknown"],
  unknown: ["delivered", "false_completion"],
};

type Rng = () => number;

function maybe(rng: Rng, p: number): boolean {
  return rng() < p;
}

function computeLabel(input: TaskInputs["label"], p: Profile, rng: Rng): unknown {
  const guesses = readLabels(input).map((g) => {
    let { label, evidenceFields, confidence } = g;
    if (maybe(rng, p.label.mislabelRate)) {
      label = pick(rng, CONFUSIONS[label] ?? ["unknown"]) as typeof label;
      confidence = 0.7 + rng() * 0.25;
      if (label === "unknown") evidenceFields = [];
    }
    if (label !== "unknown" && maybe(rng, p.label.invalidCitationRate)) {
      evidenceFields = [...evidenceFields.slice(0, 1), pick(rng, BAD_FIELDS)];
    }
    if (label !== "unknown" && maybe(rng, p.label.missingCitationRate)) evidenceFields = [];
    if (maybe(rng, p.label.lowConfidenceRate)) confidence = 0.3 + rng() * 0.29;
    return { checkpointId: g.checkpointId, label: label as string, evidenceFields, confidence: Math.round(confidence * 100) / 100 };
  });
  if (maybe(rng, p.label.schemaViolationRate)) {
    const kind = Math.floor(rng() * 3);
    if (kind === 0) return { labels: guesses };
    if (kind === 1) return guesses.map((g, i) => (i === 0 ? { ...g, label: "mostly_delivered" } : g));
    return guesses.map((g, i) => (i === 0 ? { ...g, confidence: "high" } : g));
  }
  return guesses;
}

function computeVerify(input: TaskInputs["verify"], p: Profile, rng: Rng): unknown {
  const out = input.checkpoints.map((cp) => ({
    checkpointId: cp.id,
    claims: readClaims(cp).map((c) => {
      if (!maybe(rng, p.verify.flipRate)) return c;
      if (c.status === "contradicted") return { ...c, status: "unverifiable", evidence: "could not tell" };
      if (c.status === "verified") return { ...c, status: "contradicted", evidence: "no changed file matches this claim" };
      return { ...c, status: "verified", evidence: "plausibly implemented" };
    }),
  }));
  if (maybe(rng, p.verify.schemaViolationRate)) return out.map((o) => ({ checkpointId: o.checkpointId }));
  return out;
}

function computeComplaint(input: TaskInputs["complaint"], p: Profile, rng: Rng): unknown {
  const base = readComplaint(input);
  const out: Record<string, unknown> = { ...base };
  if (base.injectionDetected && maybe(rng, p.complaint.missInjectionRate)) out.injectionDetected = false;
  if (base.injectionDetected && maybe(rng, p.complaint.obeysInjectionRate)) {
    // The model "follows" the injected instruction by emitting a credit field it was never asked for.
    out.creditUsd = 500;
  }
  if (base.disputeThreat && maybe(rng, p.complaint.missDisputeThreatRate)) out.disputeThreat = false;
  if (maybe(rng, p.complaint.schemaViolationRate)) delete out.grievances;
  return out;
}

function computeClauses(input: TaskInputs["clauses"], p: Profile, rng: Rng): unknown {
  const base = readClauses(input);
  const out = base.map((c) =>
    maybe(rng, p.clauses.wrongClauseRate) ? { ...c, clauseId: pick(rng, ["C1", "C3", "C5", "C8"]) } : c,
  );
  if (maybe(rng, p.clauses.schemaViolationRate)) return { clauses: out };
  return out;
}

function computeReply(input: TaskInputs["reply"], p: Profile, rng: Rng): string {
  const defects: TemplateDefects = {};
  if (maybe(rng, p.reply.defectRate)) {
    const credited = input.decision.lines.filter((l) => l.creditCents > 0).length;
    const kinds = ["cash", "fault", "extra", ...(credited > 1 ? ["drop"] : [])];
    const kind = pick(rng, kinds);
    if (kind === "cash") defects.cashPromise = true;
    if (kind === "fault") defects.faultAdmission = true;
    if (kind === "extra") defects.extraNumber = 1000 + Math.floor(rng() * 9000);
    if (kind === "drop") defects.dropLine = Math.floor(rng() * credited);
  }
  return renderReply(input.decision, defects);
}

function latencyMs(p: Profile, outputTokens: number, rng: Rng): number {
  const l = p.latency;
  const jitter = 1 + (rng() * 2 - 1) * l.jitter;
  let ms = (l.baseMs + outputTokens * l.perOutputTokenMs) * jitter;
  if (rng() < l.tailProbability) ms *= l.tailMultiplier;
  return Math.round(ms);
}

export class SimulatedModel implements ModelProvider {
  readonly displayName: string;
  private readonly profile: Profile;

  constructor(readonly name: ModelName) {
    this.profile = getProfile(name);
    this.displayName = this.profile.displayName;
  }

  async call<T extends Task>(task: T, rawInput: TaskInputs[T], ctx: CallContext): Promise<ModelResult> {
    // Redact first: nothing downstream, including the "model", sees a secret.
    const input = redactDeep(rawInput);
    const canonical = JSON.stringify(input);
    const rng = rngFrom(this.name, task, ctx.seed, String(ctx.attempt ?? 0), canonical);
    const p = this.profile;

    let output: unknown;
    switch (task) {
      case "complaint": output = computeComplaint(input as TaskInputs["complaint"], p, rng); break;
      case "label": output = computeLabel(input as TaskInputs["label"], p, rng); break;
      case "verify": output = computeVerify(input as TaskInputs["verify"], p, rng); break;
      case "clauses": output = computeClauses(input as TaskInputs["clauses"], p, rng); break;
      case "reply": output = computeReply(input as TaskInputs["reply"], p, rng); break;
    }

    const outText = typeof output === "string" ? output : JSON.stringify(output);
    const inputTokens = SYSTEM_PROMPT_TOKENS[task] + Math.ceil(canonical.length / 4);
    const outputTokens = Math.ceil(outText.length / 4);
    const costUsd =
      Math.round(
        ((inputTokens * p.prices.inputPerMTokUsd + outputTokens * p.prices.outputPerMTokUsd) / 1_000_000) * 1e8,
      ) / 1e8;

    return {
      output,
      usage: { inputTokens, outputTokens },
      costUsd,
      latencyMs: latencyMs(p, outputTokens, rng),
      simulated: true,
      modelName: this.name,
      promptVersion: PROMPT_VERSION,
    };
  }
}
