ALTER TABLE eval_runs ADD COLUMN cost_usd real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE eval_runs DROP COLUMN cost_cents;
