CREATE TABLE "payment_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"status" text NOT NULL,
	"amount" integer,
	"currency" text,
	"pack_key" text,
	"flux_amount" bigint,
	"credited_at" timestamp,
	"provider_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_provider_order_uidx" ON "payment_order" USING btree ("provider","provider_order_id") WHERE provider_order_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_order_user_id_idx" ON "payment_order" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_account_provider_customer_uidx" ON "provider_account" USING btree ("provider","provider_customer_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_account_provider_user_uidx" ON "provider_account" USING btree ("provider","user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "provider_account_user_id_idx" ON "provider_account" USING btree ("user_id");--> statement-breakpoint
-- Expand only. Keep stripe_* tables and user_flux.stripe_customer_id until
-- in-progress Checkout Sessions finish, expire, or get manual handling.
-- stripe_customer allowed several live rows per user. Copy the oldest live row and all deleted rows.
INSERT INTO "provider_account" ("id", "user_id", "provider", "provider_customer_id", "created_at", "updated_at", "deleted_at")
SELECT "id", "user_id", 'stripe', "stripe_customer_id", "created_at", "updated_at", "deleted_at"
FROM "stripe_customer"
WHERE "deleted_at" IS NOT NULL
UNION ALL
SELECT "id", "user_id", 'stripe', "stripe_customer_id", "created_at", "updated_at", "deleted_at"
FROM (
	SELECT DISTINCT ON ("user_id") *
	FROM "stripe_customer"
	WHERE "deleted_at" IS NULL
	ORDER BY "user_id", "created_at" ASC, "id" ASC
) live;--> statement-breakpoint
-- Copy checkout sessions so webhook retries can find them by Stripe session id.
-- flux_credited rows become paid so settle does not credit Flux again.
-- Old ledger request_id is the Stripe event id, not payment_order.id.
INSERT INTO "payment_order" (
	"id",
	"user_id",
	"provider",
	"provider_order_id",
	"status",
	"amount",
	"currency",
	"pack_key",
	"flux_amount",
	"credited_at",
	"provider_data",
	"created_at",
	"updated_at",
	"deleted_at"
)
SELECT
	"id",
	"user_id",
	'stripe',
	"stripe_session_id",
	CASE
		WHEN "flux_credited" THEN 'paid'
		WHEN "status" = 'expired' THEN 'expired'
		ELSE 'pending'
	END,
	"amount_total",
	"currency",
	CASE
		WHEN "metadata" IS NOT NULL AND btrim("metadata") LIKE '{%' THEN "metadata"::jsonb->>'packKey'
		ELSE NULL
	END,
	CASE
		WHEN "metadata" IS NOT NULL AND btrim("metadata") LIKE '{%' AND ("metadata"::jsonb->>'fluxAmount') ~ '^-?[0-9]+$'
			THEN ("metadata"::jsonb->>'fluxAmount')::bigint
		ELSE NULL
	END,
	CASE
		WHEN "flux_credited" THEN "updated_at"
		ELSE NULL
	END,
	jsonb_strip_nulls(jsonb_build_object(
		'stripeSessionId', "stripe_session_id",
		'stripeCustomerId', "stripe_customer_id",
		'mode', "mode",
		'status', "status",
		'paymentStatus', "payment_status",
		'successUrl', "success_url",
		'cancelUrl', "cancel_url",
		'stripePaymentIntentId', "stripe_payment_intent_id",
		'stripeSubscriptionId', "stripe_subscription_id",
		'expiresAt', "expires_at",
		'fluxCredited', "flux_credited",
		'metadata', CASE
			WHEN "metadata" IS NOT NULL AND btrim("metadata") LIKE '{%' THEN "metadata"::jsonb
			WHEN "metadata" IS NOT NULL THEN to_jsonb("metadata")
			ELSE NULL
		END
	)),
	"created_at",
	"updated_at",
	"deleted_at"
FROM "stripe_checkout_session";
