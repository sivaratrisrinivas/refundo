# SQLite via bun instead of Replit Postgres

The build plan assumed Replit Postgres. Refundo runs bun end to end instead: `bun --bun next`, Drizzle's `bun-sqlite` driver, and `bun test` in place of Vitest (which runs on Node and cannot import `bun:sqlite`). Tests then exercise the same driver as the app, and the project has no external database to provision.

## Considered Options

- Local Postgres 16 with Drizzle and Vitest: matches the plan, but needs a running server and Replit-specific provisioning.
- Node plus `better-sqlite3` with Vitest: keeps the plan's test runner, but adds a native dependency and was not what the owner asked for.

## Consequences

- `jsonb` and `text[]` columns become JSON text columns.
- The unique idempotency index on the outbox still works and still makes a second approve fail.
- A SQLite file is not shared across Replit Autoscale instances, so a Replit deploy needs a Reserved VM, or a seed-on-boot read-mostly demo.
- Moving back to Postgres later means a driver swap plus a column-type migration.
