import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// NOTICE: bare userId is intentional — no FK to user.id. better-auth hard-deletes
// the user row; a cascade would wipe these soft-delete archive rows.
// See `server/apps/api/docs/ai-context/account-deletion.md`.
export const userFlux = pgTable('user_flux', {
  userId: text('user_id').primaryKey(),
  flux: bigint('flux', { mode: 'number' }).notNull().default(0),
  // NOTICE:
  // Unused at runtime. drizzle-kit generate emits DROP COLUMN if this
  // field is removed from the schema.
  // Source: server/apps/api/drizzle/0023_payment_order.sql
  // Removal condition: a later SQL migration drops the column after this
  // release is fully rolled.
  stripeCustomerId: text('stripe_customer_id'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})
