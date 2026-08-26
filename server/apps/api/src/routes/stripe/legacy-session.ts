import type Stripe from 'stripe'

import type { Database } from '../../libs/db'

import { and, eq } from 'drizzle-orm'

import { createInternalError } from '../../utils/error'

import * as paymentSchema from '../../schemas/payment'
import * as stripeSchema from '../../schemas/stripe'

type LegacyCheckoutRow = typeof stripeSchema.stripeCheckoutSession.$inferSelect

/**
 * Finds the `payment_order` id for a verified Checkout Session.
 *
 * NOTICE:
 * New Sessions store `metadata.payment_order_id`. Sessions created before
 * the expand migration do not. The old process can also insert a
 * `stripe_checkout_session` row while the new process runs the backfill.
 * This lookup covers those Sessions until they finish, expire, or get
 * manual handling.
 * Root cause: webhook used to claim by `stripe_session_id` and
 * `flux_credited`. CORE now claims by `payment_order.id`.
 * Source: `server/apps/api/drizzle/0023_payment_order.sql` and the
 * expand/contract split of the Stripe table migration.
 * Removal condition: drop this module in the contract PR after soak
 * confirms no pending old Sessions remain.
 */
export async function resolvePaymentOrderId(
  db: Database,
  session: Stripe.Checkout.Session,
): Promise<string> {
  const fromMetadata = session.metadata?.payment_order_id
  if (fromMetadata)
    return fromMetadata

  const [existing] = await db
    .select({ id: paymentSchema.paymentOrder.id })
    .from(paymentSchema.paymentOrder)
    .where(and(
      eq(paymentSchema.paymentOrder.provider, 'stripe'),
      eq(paymentSchema.paymentOrder.providerOrderId, session.id),
    ))
    .limit(1)

  if (existing)
    return existing.id

  const adoptedId = await adoptCheckoutSession(db, session.id)
  if (adoptedId)
    return adoptedId

  throw createInternalError('Payment confirmation is missing payment_order_id')
}

async function adoptCheckoutSession(db: Database, stripeSessionId: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(stripeSchema.stripeCheckoutSession)
    .where(eq(stripeSchema.stripeCheckoutSession.stripeSessionId, stripeSessionId))
    .limit(1)

  if (!row)
    return undefined

  await db.insert(paymentSchema.paymentOrder).values(paymentOrderFromCheckoutRow(row)).onConflictDoNothing()

  const [adopted] = await db
    .select({ id: paymentSchema.paymentOrder.id })
    .from(paymentSchema.paymentOrder)
    .where(and(
      eq(paymentSchema.paymentOrder.provider, 'stripe'),
      eq(paymentSchema.paymentOrder.providerOrderId, stripeSessionId),
    ))
    .limit(1)

  return adopted?.id
}

function paymentOrderFromCheckoutRow(row: LegacyCheckoutRow) {
  const metadata = parseLegacyMetadata(row.metadata)

  return {
    id: row.id,
    userId: row.userId,
    provider: 'stripe' as const,
    providerOrderId: row.stripeSessionId,
    status: legacyCheckoutStatus(row),
    amount: row.amountTotal ?? undefined,
    currency: row.currency ?? undefined,
    packKey: stringField(metadata, 'packKey'),
    fluxAmount: fluxAmountFromMetadata(metadata),
    creditedAt: row.fluxCredited ? row.updatedAt : undefined,
    providerData: {
      stripeSessionId: row.stripeSessionId,
      stripeCustomerId: row.stripeCustomerId,
      mode: row.mode,
      status: row.status,
      paymentStatus: row.paymentStatus,
      successUrl: row.successUrl,
      cancelUrl: row.cancelUrl,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      expiresAt: row.expiresAt,
      fluxCredited: row.fluxCredited,
      metadata,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function legacyCheckoutStatus(row: Pick<LegacyCheckoutRow, 'fluxCredited' | 'status'>) {
  if (row.fluxCredited)
    return 'paid'
  if (row.status === 'expired')
    return 'expired'
  return 'pending'
}

function parseLegacyMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (raw == null || raw.trim() === '')
    return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
      return undefined
    return parsed as Record<string, unknown>
  }
  catch {
    return undefined
  }
}

function stringField(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function fluxAmountFromMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.fluxAmount
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string' && /^-?\d+$/.test(value))
    return Number(value)
  return undefined
}
