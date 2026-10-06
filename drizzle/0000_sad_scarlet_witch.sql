CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text NOT NULL,
	`tenure_days` integer NOT NULL,
	`credits_granted_30d_cents` integer DEFAULT 0 NOT NULL,
	`prior_disputes` integer DEFAULT 0 NOT NULL,
	`orb_customer_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bug_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pattern` text NOT NULL,
	`linear_issue_ref` text NOT NULL,
	`confirmed_source_url` text,
	`synthetic` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` text NOT NULL,
	`mode` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text NOT NULL,
	`cost_cents` integer NOT NULL,
	`request_text` text NOT NULL,
	`agent_claim_text` text NOT NULL,
	`files_changed` text NOT NULL,
	`lines_added` integer NOT NULL,
	`lines_removed` integer NOT NULL,
	`app_test` text NOT NULL,
	`rolled_back_at` text,
	`error_text` text,
	`error_signature` text,
	`orb_block_id` text NOT NULL,
	`plan_mode` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `checkpoints_session_idx` ON `checkpoints` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`session_id` text,
	`labels` text NOT NULL,
	`clauses` text NOT NULL,
	`lines` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`cap_status` text NOT NULL,
	`status` text NOT NULL,
	`approver` text,
	`override_reason` text,
	`policy_version` text NOT NULL,
	`model_name` text NOT NULL,
	`prompt_version` text NOT NULL,
	`complaint` text,
	`injection_detected` integer DEFAULT false NOT NULL,
	`reply` text,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	`approved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_ticket_idx` ON `decisions` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model` text NOT NULL,
	`case_id` text NOT NULL,
	`expected` text NOT NULL,
	`actual` text NOT NULL,
	`pass` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`source_url` text NOT NULL,
	`synthetic` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_id` text NOT NULL,
	`system` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`idempotency_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_idempotency_idx` ON `outbox` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`started_at` text NOT NULL,
	`total_cost_cents` integer NOT NULL,
	`failure_pattern` text NOT NULL,
	`graded` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`session_id` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`tags` text NOT NULL,
	`pi_id` text,
	`dispute_threatened` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL
);
