import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Ten tables (ADR 0001). JSON columns are JSON text. Money is integer cents.
 * `sessions.failure_pattern` is for the generator and eval only: the pipeline
 * must never read it.
 */

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["core", "pro", "enterprise"] }).notNull(),
  tenureDays: integer("tenure_days").notNull(),
  creditsGranted30dCents: integer("credits_granted_30d_cents").notNull().default(0),
  priorDisputes: integer("prior_disputes").notNull().default(0),
  orbCustomerId: text("orb_customer_id").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  startedAt: text("started_at").notNull(),
  totalCostCents: integer("total_cost_cents").notNull(),
  failurePattern: text("failure_pattern").notNull(),
  graded: integer("graded", { mode: "boolean" }).notNull().default(false),
});

export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    seq: integer("seq").notNull(),
    ts: text("ts").notNull(),
    mode: text("mode", { enum: ["free", "power", "max"] }).notNull(),
    model: text("model").notNull(),
    reasoningEffort: text("reasoning_effort", { enum: ["low", "medium", "high"] }).notNull(),
    costCents: integer("cost_cents").notNull(),
    requestText: text("request_text").notNull(),
    agentClaimText: text("agent_claim_text").notNull(),
    filesChanged: text("files_changed", { mode: "json" }).$type<string[]>().notNull(),
    linesAdded: integer("lines_added").notNull(),
    linesRemoved: integer("lines_removed").notNull(),
    appTest: text("app_test", { mode: "json" })
      .$type<{ ran: boolean; passed: boolean | null; failedSteps: string[] }>()
      .notNull(),
    rolledBackAt: text("rolled_back_at"),
    errorText: text("error_text"),
    errorSignature: text("error_signature"),
    orbBlockId: text("orb_block_id").notNull(),
    planMode: integer("plan_mode", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("checkpoints_session_idx").on(t.sessionId, t.seq)],
);

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  sessionId: text("session_id"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  piId: text("pi_id"),
  disputeThreatened: integer("dispute_threatened", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  status: text("status", { enum: ["open", "decided", "approved", "needs_lead"] })
    .notNull()
    .default("open"),
});

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  sourceUrl: text("source_url").notNull(),
  synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
});

export const bugSignatures = sqliteTable("bug_signatures", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pattern: text("pattern").notNull(),
  linearIssueRef: text("linear_issue_ref").notNull(),
  confirmedSourceUrl: text("confirmed_source_url"),
  synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
});

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    sessionId: text("session_id"),
    labels: text("labels", { mode: "json" }).$type<unknown[]>().notNull(),
    clauses: text("clauses", { mode: "json" }).$type<string[]>().notNull(),
    lines: text("lines", { mode: "json" }).$type<unknown[]>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    capStatus: text("cap_status").notNull(),
    status: text("status").notNull(),
    approver: text("approver"),
    overrideReason: text("override_reason"),
    policyVersion: text("policy_version").notNull(),
    modelName: text("model_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    complaint: text("complaint", { mode: "json" }).$type<unknown>(),
    injectionDetected: integer("injection_detected", { mode: "boolean" }).notNull().default(false),
    reply: text("reply"),
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: text("created_at").notNull(),
    approvedAt: text("approved_at"),
  },
  (t) => [uniqueIndex("decisions_ticket_idx").on(t.ticketId)],
);

export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    decisionId: text("decision_id").notNull(),
    system: text("system", { enum: ["orb", "zendesk", "linear"] }).notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull(),
    // sha256(session_id + ":" + system): the Session alone gates a second Credit.
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [uniqueIndex("outbox_idempotency_idx").on(t.idempotencyKey)],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

export const evalRuns = sqliteTable("eval_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  model: text("model").notNull(),
  caseId: text("case_id").notNull(),
  expected: text("expected", { mode: "json" }).$type<unknown>().notNull(),
  actual: text("actual", { mode: "json" }).$type<unknown>().notNull(),
  pass: integer("pass", { mode: "boolean" }).notNull(),
  costCents: integer("cost_cents").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: text("created_at").notNull(),
});
