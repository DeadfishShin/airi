import type Stripe from 'stripe'

import type { Database } from '../../libs/db'
import type { ConfigKVService } from '../../services/adapters/config-kv'

import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createTestRedis } from '../../libs/tests/redis'
import { createBillingService } from '../../services/domain/billing/billing-service'
import { createPaymentService } from '../../services/domain/payment'
import { createWebhookOperation, resolvePaymentOrderId } from './operations/webhook'

import * as schema from '../../schemas'

function createPacksConfigKV(): ConfigKVService {
  return {
    getOptional: vi.fn(async () => null),
    getOrThrow: vi.fn(),
    get: vi.fn(),
    refresh: vi.fn(),
    invalidateCache: vi.fn(),
  } as ConfigKVService
}

function checkoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_legacy_1',
    customer: 'cus_legacy',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 500,
    currency: 'usd',
    metadata: {},
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

describe('payment order lookup', () => {
  let db: Database
  let payment: ReturnType<typeof createPaymentService>

  beforeAll(async () => {
    db = await mockDB(schema)
    await db.insert(schema.user).values({
      id: 'user-legacy-1',
      name: 'Legacy User',
      email: 'legacy@example.com',
    })
  })

  beforeEach(async () => {
    const redis = createTestRedis()
    const billing = createBillingService(db, redis, createPacksConfigKV())
    payment = createPaymentService(db, billing)

    await db.delete(schema.fluxTransaction).where(eq(schema.fluxTransaction.userId, 'user-legacy-1'))
    await db.delete(schema.userFlux).where(eq(schema.userFlux.userId, 'user-legacy-1'))
    await db.delete(schema.paymentOrder).where(eq(schema.paymentOrder.userId, 'user-legacy-1'))
    await db.delete(schema.providerAccount).where(eq(schema.providerAccount.userId, 'user-legacy-1'))
  })

  async function insertBackfilledOrder(status: 'pending' | 'paid' = 'pending') {
    const [order] = await db.insert(schema.paymentOrder).values({
      userId: 'user-legacy-1',
      provider: 'stripe',
      providerOrderId: 'cs_legacy_1',
      status,
      packKey: 'starter',
      fluxAmount: 500,
      currency: 'usd',
      creditedAt: status === 'paid' ? new Date() : undefined,
    }).returning()
    return order!
  }

  function webhookForSession(session: Stripe.Checkout.Session) {
    return createWebhookOperation(
      {
        webhooks: {
          constructEvent: vi.fn(() => ({
            id: 'evt_legacy',
            type: 'checkout.session.completed',
            data: { object: session },
          })),
        },
      } as any,
      'whsec_test',
      payment,
      db,
      null,
      null,
    )
  }

  it('returns metadata.payment_order_id without querying provider_order_id', async () => {
    const id = await resolvePaymentOrderId(db, checkoutSession({
      metadata: { payment_order_id: 'po_from_metadata' },
    }))
    expect(id).toBe('po_from_metadata')
  })

  it('finds a backfilled order by Stripe session id', async () => {
    const order = await insertBackfilledOrder()
    const id = await resolvePaymentOrderId(db, checkoutSession({ metadata: {} }))
    expect(id).toBe(order.id)
  })

  it('throws when the Session is missing from payment_order so Stripe can retry', async () => {
    await expect(resolvePaymentOrderId(db, checkoutSession({ metadata: {} }))).rejects.toMatchObject({
      statusCode: 500,
    })
  })

  it('settles a backfilled pending order found by session id', async () => {
    const order = await insertBackfilledOrder('pending')
    const webhook = webhookForSession(checkoutSession({ metadata: {} }))

    await webhook('test_sig', '{}')

    const [paid] = await db.select().from(schema.paymentOrder).where(eq(schema.paymentOrder.id, order.id))
    expect(paid?.status).toBe('paid')

    const ledger = await db.select().from(schema.fluxTransaction).where(eq(schema.fluxTransaction.userId, 'user-legacy-1'))
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.requestId).toBe(order.id)
  })

  it('does not credit Flux again for a backfilled paid order', async () => {
    await insertBackfilledOrder('paid')
    await db.insert(schema.userFlux).values({ userId: 'user-legacy-1', flux: 500 })
    await db.insert(schema.fluxTransaction).values({
      userId: 'user-legacy-1',
      type: 'credit',
      amount: 500,
      balanceBefore: 0,
      balanceAfter: 500,
      requestId: 'evt_old_stripe',
      description: 'Stripe payment USD 5.00',
      metadata: { stripeSessionId: 'cs_legacy_1', source: 'stripe.checkout.completed' },
    })

    const webhook = webhookForSession(checkoutSession({ metadata: {} }))
    await webhook('test_sig', '{}')

    const ledger = await db.select().from(schema.fluxTransaction).where(eq(schema.fluxTransaction.userId, 'user-legacy-1'))
    expect(ledger).toHaveLength(1)

    const [flux] = await db.select().from(schema.userFlux).where(eq(schema.userFlux.userId, 'user-legacy-1'))
    expect(flux?.flux).toBe(500)
  })

  it('returns 500 when webhook cannot resolve a Session', async () => {
    const webhook = webhookForSession(checkoutSession({ metadata: {} }))
    await expect(webhook('test_sig', '{}')).rejects.toMatchObject({
      statusCode: 500,
    })
  })
})
