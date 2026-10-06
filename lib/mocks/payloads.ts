import { createHash } from "node:crypto";
import { z } from "zod";
import type { CaseBugSignature } from "@/lib/pipeline/types";

/**
 * Mock systems accept real-shaped payloads and record them in the outbox.
 * Shapes follow the public docs for Orb "create ledger entry", the Zendesk
 * Tickets API update, and Linear's GraphQL issueCreate. All data is synthetic.
 */

export const orbIncrementSchema = z.strictObject({
  endpoint: z.string().regex(/^POST \/v1\/customers\/[\w-]+\/credits\/ledger_entry$/),
  body: z.strictObject({
    entry_type: z.literal("increment"),
    amount: z.number().positive(),
    per_unit_cost_basis: z.literal("0"),
    description: z.string().min(1),
    metadata: z.strictObject({
      decision_id: z.string(), session_id: z.string(), ticket_id: z.string(),
      clause_ids: z.array(z.string()), policy_version: z.string(),
    }),
  }),
});

export const orbAmendmentSchema = z.strictObject({
  endpoint: z.string().regex(/^POST \/v1\/customers\/[\w-]+\/credits\/ledger_entry$/),
  body: z.strictObject({
    entry_type: z.literal("amendment"),
    amount: z.number().positive(),
    block_id: z.string().min(1),
    description: z.string().min(1),
  }),
});
export const orbSchema = z.union([orbIncrementSchema, orbAmendmentSchema]);

export const zendeskSchema = z.strictObject({
  endpoint: z.string().regex(/^PUT \/api\/v2\/tickets\/[\w-]+\.json$/),
  body: z.strictObject({
    ticket: z.strictObject({
      comment: z.strictObject({ body: z.string().min(1), public: z.literal(true) }),
      tags: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1),
      status: z.literal("solved"),
    }),
  }),
});

export const linearSchema = z.strictObject({
  endpoint: z.literal("POST https://api.linear.app/graphql"),
  body: z.strictObject({
    query: z.string().includes("issueCreate"),
    variables: z.strictObject({
      input: z.strictObject({
        teamId: z.string(), title: z.string().min(1), description: z.string().min(1), labelNames: z.array(z.string()).min(1),
      }),
    }),
  }),
});

export type OrbPayload = z.infer<typeof orbSchema>;
export type ZendeskPayload = z.infer<typeof zendeskSchema>;
export type LinearPayload = z.infer<typeof linearSchema>;

export const MOCK_SCHEMAS = { orb: orbSchema, zendesk: zendeskSchema, linear: linearSchema } as const;
export type MockSystem = keyof typeof MOCK_SCHEMAS;

export function orbPayload(a: {
  orbCustomerId: string; amountCents: number; decisionId: string; sessionId: string; ticketId: string; clauseIds: string[]; policyVersion: string;
}): OrbPayload {
  return {
    endpoint: `POST /v1/customers/${a.orbCustomerId}/credits/ledger_entry`,
    body: {
      entry_type: "increment",
      amount: a.amountCents / 100, // one credit unit is one dollar of goodwill
      per_unit_cost_basis: "0", // goodwill stays separate from paid credits
      description: `Goodwill credit for failed Agent work (Session ${a.sessionId})`,
      metadata: { decision_id: a.decisionId, session_id: a.sessionId, ticket_id: a.ticketId, clause_ids: a.clauseIds, policy_version: a.policyVersion },
    },
  };
}

export function zendeskPayload(a: { ticketId: string; reply: string; clauseIds: string[]; credited: boolean }): ZendeskPayload {
  return {
    endpoint: `PUT /api/v2/tickets/${a.ticketId}.json`,
    body: {
      ticket: {
        comment: { body: a.reply, public: true },
        tags: [a.credited ? "credit_issued" : "no_credit_issued", ...a.clauseIds.map((c) => c.toLowerCase())],
        status: "solved",
      },
    },
  };
}

export function linearPayload(a: {
  bug: CaseBugSignature; sessionId: string; ticketId: string; checkpointIds: string[];
}): LinearPayload {
  return {
    endpoint: "POST https://api.linear.app/graphql",
    body: {
      query: "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
      variables: {
        input: {
          teamId: "TEAM-AGENT-BILLING",
          title: `[Known bug] ${a.bug.name}`,
          description: `Matched bug signature ${a.bug.id} (${a.bug.linearIssueRef}).\nSession: ${a.sessionId}\nTicket: ${a.ticketId}\nCheckpoints: ${a.checkpointIds.join(", ")}`,
          labelNames: ["agent-billing"],
        },
      },
    },
  };
}

/** Orb and Linear writes are keyed on the Session alone; a Zendesk reply belongs to its Ticket. */
export function idempotencyKey(system: MockSystem, ids: { sessionId: string | null; ticketId: string }): string {
  const scope = system === "zendesk" ? `ticket:${ids.ticketId}` : `session:${ids.sessionId}`;
  return createHash("sha256").update(`${scope}:${system}`).digest("hex");
}

export function validateMockPayload(system: MockSystem, payload: unknown): { ok: true } | { ok: false; error: string } {
  const r = MOCK_SCHEMAS[system].safeParse(payload);
  return r.success ? { ok: true } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
