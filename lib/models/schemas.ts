import { z } from "zod";
import { LABELS } from "@/lib/policy/types";

/** Strict schemas: a model's raw output is rejected, never repaired. */
export const verifySchema = z.array(
  z.strictObject({
    checkpointId: z.string(),
    claims: z.array(
      z.strictObject({
        claim: z.string(),
        status: z.enum(["verified", "contradicted", "unverifiable"]),
        evidence: z.string(),
      }),
    ),
  }),
);

export const labelSchema = z.array(
  z.strictObject({
    checkpointId: z.string(),
    label: z.enum(LABELS),
    evidenceFields: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  }),
);

export const complaintSchema = z.strictObject({
  grievances: z.array(
    z.strictObject({ text: z.string(), timeRef: z.string().optional(), amountRef: z.string().optional() }),
  ),
  disputeThreat: z.boolean(),
  injectionDetected: z.boolean(),
});

export const clausesSchema = z.array(z.strictObject({ clauseId: z.string(), reason: z.string() }));

export type VerifyOutput = z.infer<typeof verifySchema>;
export type LabelOutput = z.infer<typeof labelSchema>;
export type ComplaintOutput = z.infer<typeof complaintSchema>;
