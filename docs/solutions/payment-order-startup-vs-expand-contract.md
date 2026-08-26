---
module: server/apps/api
tags: [stripe, payment-order, drizzle, migrate-on-startup, rolling-deploy]
problem_type: research
---

# payment_order startup versus expand/contract

Findings date: 2026-08-26.

This note records why AIRI copies Stripe checkout rows in SQL and does not keep a dual-schema adapter in the API process.

## What expand/contract is

Martin Fowler names three phases: expand, migrate, and contract.

- Expand adds a new structure next to the old structure.
- Migrate moves callers to the new structure.
- Contract removes the old structure.

Source: [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html).

Liquibase says this pattern exists because old code and new code share one database during a rolling deploy. An additive change is usually compatible. A drop or a rename in the same release as new code is not compatible.

Sources: [What is Expand-Contract Pattern?](https://www.liquibase.com/technical-glossary/expand-contract-pattern), [What is Backward-Compatible Schema Change?](https://www.liquibase.com/technical-glossary/backward-compatible-schema-change).

Flyway says dual-write exists for application v1 against schema v2. Expand and contract do not belong in the same release.

Source: [Rolling out updates from a single schema to multiple production databases](https://documentation.red-gate.com/flyway/deploying-database-changes-using-flyway/rolling-out-updates-from-a-single-schema-to-multiple-production-databases).

Prisma says dual paths are the cost of a mixed fleet. A planned maintenance change can update schema and client code in one step.

Sources: [Customizing migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations), [Strategies for deploying database migrations](https://www.prisma.io/dataguide/types/relational/migration-strategies).

Kubernetes RollingUpdate keeps old Pods and new Pods in service at the same time. It does not order schema changes against code changes.

Source: [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/).

Drizzle runtime `migrate()` applies journal SQL when the process starts. That is a when-to-run option. It is not a mixed-version protocol.

Source: [Drizzle migrations](https://orm.drizzle.team/docs/migrations).

## What AIRI startup does

Each API replica connects to Postgres. Then it runs `migrateDatabase()`. Then it serves traffic.

Railway health uses `/readyz` after this boot. There is no preDeploy migrate job.

Sources: [`server/apps/api/src/libs/db.ts`](../../server/apps/api/src/libs/db.ts), [`server/apps/api/src/app.ts`](../../server/apps/api/src/app.ts), [`server/apps/api/railway.toml`](../../server/apps/api/railway.toml).

As a result, the first new replica applies `0023_payment_order.sql` while old replicas still run. Old replicas still read and write `stripe_*` tables.

## Decision

`0023_payment_order.sql` creates `payment_order` and copies old checkout rows. The file does not DROP `stripe_*` tables. Old replicas stay compatible during the roll.

The API process does not dual-write. New checkout writes `payment_order` only. The SQL file copies existing rows.

The webhook finds an order from `metadata.payment_order_id`. If that field is absent, it finds the row by Stripe session id on `payment_order`. If both lookups miss, it throws so Stripe retries.

A runtime adopt path that copies leftover `stripe_checkout_session` rows into `payment_order` is a second mapping of the same SQL. This repo does not run a contract job at startup.

The TypeScript table defs stay in the schema so `drizzle-kit generate` does not emit DROP. A later SQL migration can drop them after this release is fully rolled.
