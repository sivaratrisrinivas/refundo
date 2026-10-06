ALTER TABLE `decisions` ADD `subtotal_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `needs_human` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `needs_lead` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `route_to` text;--> statement-breakpoint
ALTER TABLE `decisions` ADD `file_linear` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `ceiling_cents` integer;--> statement-breakpoint
ALTER TABLE `decisions` ADD `headroom_cents` integer;--> statement-breakpoint
ALTER TABLE `decisions` ADD `unresolved` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `prior_credit` text;--> statement-breakpoint
ALTER TABLE `decisions` ADD `overrides` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `trace` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `decisions` ADD `latency_ms` integer DEFAULT 0 NOT NULL;