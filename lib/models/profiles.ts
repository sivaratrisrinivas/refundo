import { z } from "zod";
import raw from "./profiles.json";
import type { ModelName } from "./types";

const rate = z.number().min(0).max(1);

const profileSchema = z.strictObject({
  displayName: z.string(),
  prices: z.strictObject({
    inputPerMTokUsd: z.number().positive(),
    outputPerMTokUsd: z.number().positive(),
    illustrative: z.literal(true),
  }),
  latency: z.strictObject({
    baseMs: z.number().positive(),
    perOutputTokenMs: z.number().positive(),
    jitter: rate,
    tailProbability: rate,
    tailMultiplier: z.number().min(1),
  }),
  complaint: z.strictObject({
    schemaViolationRate: rate,
    missInjectionRate: rate,
    obeysInjectionRate: rate,
    missDisputeThreatRate: rate,
  }),
  label: z.strictObject({
    schemaViolationRate: rate,
    mislabelRate: rate,
    invalidCitationRate: rate,
    missingCitationRate: rate,
    lowConfidenceRate: rate,
  }),
  verify: z.strictObject({ schemaViolationRate: rate, flipRate: rate }),
  clauses: z.strictObject({ schemaViolationRate: rate, wrongClauseRate: rate }),
  reply: z.strictObject({ defectRate: rate }),
});

export type Profile = z.infer<typeof profileSchema>;

const fileSchema = z.object({
  _note: z.string(),
  "sim-a": profileSchema,
  "sim-b": profileSchema,
});

const parsed = fileSchema.parse(raw);

export function getProfile(name: ModelName): Profile {
  return parsed[name];
}
