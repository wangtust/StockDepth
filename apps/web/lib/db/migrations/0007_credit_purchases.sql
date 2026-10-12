ALTER TABLE "credit_transactions"
ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_transactions_stripe_checkout_session_id_idx"
ON "credit_transactions" ("stripe_checkout_session_id")
WHERE "stripe_checkout_session_id" IS NOT NULL;
