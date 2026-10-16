CREATE TABLE "billing_accounts" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"analysis_credits" integer DEFAULT 0 NOT NULL,
	"ledger_sequence" bigint DEFAULT 0 NOT NULL,
	"ledger_opening_balance" integer DEFAULT 0 NOT NULL,
	"ledger_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_product_id" text,
	"plan_name" varchar(50),
	"subscription_status" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_nonnegative" CHECK ("billing_accounts"."analysis_credits" >= 0 AND "billing_accounts"."ledger_opening_balance" >= 0 AND "billing_accounts"."ledger_sequence" >= 0 AND "billing_accounts"."ledger_sequence" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "llm_model_config_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" integer NOT NULL,
	"version" integer NOT NULL,
	"provider" varchar(80) NOT NULL,
	"base_url" text NOT NULL,
	"model_name" varchar(160) NOT NULL,
	"model_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"input_price" numeric(15, 6),
	"cache_price" numeric(15, 6),
	"output_price" numeric(15, 6),
	"price_currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"price_unit_tokens" integer DEFAULT 1000000 NOT NULL,
	"provenance" text DEFAULT 'configured' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_versions_values_valid" CHECK ("llm_model_config_versions"."version" > 0 AND "llm_model_config_versions"."price_unit_tokens" > 0 AND ("llm_model_config_versions"."input_price" IS NULL OR "llm_model_config_versions"."input_price" >= 0) AND ("llm_model_config_versions"."cache_price" IS NULL OR "llm_model_config_versions"."cache_price" >= 0) AND ("llm_model_config_versions"."output_price" IS NULL OR "llm_model_config_versions"."output_price" >= 0) AND jsonb_typeof("llm_model_config_versions"."model_options") = 'object' AND "llm_model_config_versions"."provenance" IN ('configured','historical_snapshot') AND "llm_model_config_versions"."encrypted_api_key" LIKE 'sdkey:%')
);
--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD COLUMN "previous_quick_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD COLUMN "previous_deep_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD COLUMN "next_quick_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD COLUMN "next_deep_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD COLUMN "configuration_state" text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD COLUMN "initiator" text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "quick_model_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "deep_model_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "configuration_state" text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "charged_credits" integer;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "model_version_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "cost_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "ledger_sequence" bigint;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "balance_after" integer;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "operation_key" varchar(160);--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "current_version_id" integer;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD COLUMN "trader_model_version_id" integer;--> statement-breakpoint
ALTER TABLE "paper_model_calls" ADD COLUMN "model_version_id" integer;--> statement-breakpoint
ALTER TABLE "paper_model_calls" ADD COLUMN "cost_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_model_config_versions" ADD CONSTRAINT "llm_model_config_versions_config_id_llm_model_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."llm_model_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_customer_unique" ON "billing_accounts" USING btree ("stripe_customer_id") WHERE "billing_accounts"."stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_subscription_unique" ON "billing_accounts" USING btree ("stripe_subscription_id") WHERE "billing_accounts"."stripe_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_config_version_unique" ON "llm_model_config_versions" USING btree ("config_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_id_config_unique" ON "llm_model_config_versions" USING btree ("id","config_id");--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_job_resumptions_previous_quick_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("previous_quick_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_job_resumptions_previous_deep_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("previous_deep_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_job_resumptions_next_quick_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("next_quick_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_job_resumptions_next_deep_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("next_deep_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_quick_model_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("quick_model_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_deep_model_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("deep_model_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD CONSTRAINT "analysis_model_calls_model_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD CONSTRAINT "model_configs_current_version_owner_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."llm_model_config_versions"("id","config_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_analysis_runs_trader_model_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("trader_model_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_model_calls" ADD CONSTRAINT "paper_model_calls_model_version_id_llm_model_config_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."llm_model_config_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_user_sequence_unique" ON "credit_transactions" USING btree ("user_id","ledger_sequence") WHERE "credit_transactions"."ledger_sequence" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_user_operation_unique" ON "credit_transactions" USING btree ("user_id","operation_key") WHERE "credit_transactions"."operation_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_transactions_user_id_idx" ON "credit_transactions" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "credit_transactions_job_owner_idx" ON "credit_transactions" USING btree ("job_id","user_id") WHERE "credit_transactions"."job_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_configuration_state" CHECK (("analysis_jobs"."configuration_state" = 'legacy_unknown' AND "analysis_jobs"."quick_model_version_id" IS NULL AND "analysis_jobs"."deep_model_version_id" IS NULL) OR ("analysis_jobs"."configuration_state" = 'versioned' AND "analysis_jobs"."quick_model_version_id" IS NOT NULL AND "analysis_jobs"."deep_model_version_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_charged_credits_nonnegative" CHECK ("analysis_jobs"."charged_credits" IS NULL OR "analysis_jobs"."charged_credits" >= 0);--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_v2_balance_valid" CHECK (("credit_transactions"."ledger_sequence" IS NULL AND "credit_transactions"."balance_after" IS NULL) OR ("credit_transactions"."ledger_sequence" IS NOT NULL AND "credit_transactions"."balance_after" IS NOT NULL AND "credit_transactions"."ledger_sequence" > 0 AND "credit_transactions"."ledger_sequence" <= 9007199254740991 AND "credit_transactions"."balance_after" >= 0));
--> statement-breakpoint
-- Cutover baseline: preserve balances and payment identities without inventing old transactions.
INSERT INTO billing_accounts (user_id, analysis_credits, ledger_opening_balance,
  stripe_customer_id, stripe_subscription_id, stripe_product_id, plan_name, subscription_status)
SELECT id, analysis_credits, analysis_credits,
  stripe_customer_id, stripe_subscription_id, stripe_product_id, plan_name, subscription_status
FROM users;
--> statement-breakpoint
-- New identities start with zero in the authoritative account; grants use actual ledger entries.
CREATE FUNCTION stockdepth_create_billing_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO billing_accounts(user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_create_billing_account AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION stockdepth_create_billing_account();
--> statement-breakpoint
CREATE FUNCTION stockdepth_immutable_model_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Model execution versions are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER model_versions_immutable BEFORE UPDATE OR DELETE ON llm_model_config_versions
FOR EACH ROW EXECUTE FUNCTION stockdepth_immutable_model_version();
--> statement-breakpoint
CREATE FUNCTION stockdepth_append_only_v2_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ledger_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'Sequenced credit transactions are append-only' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_transactions_v2_append_only BEFORE UPDATE OR DELETE ON credit_transactions
FOR EACH ROW EXECUTE FUNCTION stockdepth_append_only_v2_ledger();
