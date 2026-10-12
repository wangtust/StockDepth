CREATE TABLE "daily_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"trading_date" date NOT NULL,
	"open" numeric(24, 8) NOT NULL,
	"high" numeric(24, 8) NOT NULL,
	"low" numeric(24, 8) NOT NULL,
	"close" numeric(24, 8) NOT NULL,
	"volume" bigint NOT NULL,
	"source" varchar(40) NOT NULL,
	"adjusted" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_prices_ohlcv_valid" CHECK ("daily_prices"."low" > 0 AND "daily_prices"."high" >= "daily_prices"."low" AND "daily_prices"."open" BETWEEN "daily_prices"."low" AND "daily_prices"."high" AND "daily_prices"."close" BETWEEN "daily_prices"."low" AND "daily_prices"."high" AND "daily_prices"."high" < 10000000000000000 AND "daily_prices"."volume" >= 0)
);
--> statement-breakpoint
CREATE TABLE "instrument_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"vendor" varchar(40) NOT NULL,
	"vendor_symbol" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'unresolved' NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(40) NOT NULL,
	"exchange" varchar(40) NOT NULL,
	"name" varchar(160),
	"currency" varchar(12),
	"timezone" varchar(80),
	"status" varchar(20) DEFAULT 'unresolved' NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "instruments_status_valid" CHECK ("instruments"."status" in ('verified','unresolved','inactive')),
	CONSTRAINT "instruments_verified_identity" CHECK ("instruments"."status" <> 'verified' OR ("instruments"."currency" IS NOT NULL AND "instruments"."timezone" IS NOT NULL AND "instruments"."verified_at" IS NOT NULL AND "instruments"."exchange" <> 'UNRESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "market_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"claimed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"category" varchar(20) NOT NULL,
	"last_success_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_summary" varchar(160),
	"lease_until" timestamp with time zone,
	"owner" uuid,
	CONSTRAINT "market_sync_state_category_valid" CHECK ("market_sync_state"."category" in ('identity','quote','daily') AND "market_sync_state"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" integer NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"currency" varchar(12) NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(40) NOT NULL,
	"price_type" varchar(40) NOT NULL,
	"session" varchar(20) NOT NULL,
	CONSTRAINT "price_snapshots_price_valid" CHECK ("price_snapshots"."price" > 0 AND "price_snapshots"."price" < 10000000000000000 AND "price_snapshots"."price_type" = 'regular_unadjusted' AND "price_snapshots"."session" = 'regular')
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "instrument_id" integer;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "instrument_id" integer;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "price_snapshot_id" integer;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "execution_price" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "instrument_id" integer;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD COLUMN "instrument_id" integer;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_sources" ADD CONSTRAINT "instrument_sources_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_sync_state" ADD CONSTRAINT "market_sync_state_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_prices_identity_idx" ON "daily_prices" USING btree ("instrument_id","trading_date","source","adjusted");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_sources_vendor_symbol_idx" ON "instrument_sources" USING btree ("vendor","vendor_symbol");--> statement-breakpoint
CREATE INDEX "instrument_sources_instrument_idx" ON "instrument_sources" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_exchange_symbol_idx" ON "instruments" USING btree ("exchange","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "market_sync_state_instrument_category_idx" ON "market_sync_state" USING btree ("instrument_id","category");--> statement-breakpoint
CREATE INDEX "market_sync_state_due_idx" ON "market_sync_state" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_snapshots_identity_idx" ON "price_snapshots" USING btree ("instrument_id","source","quoted_at","price_type");--> statement-breakpoint
CREATE INDEX "price_snapshots_latest_idx" ON "price_snapshots" USING btree ("instrument_id","quoted_at");--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_price_snapshot_id_price_snapshots_id_fk" FOREIGN KEY ("price_snapshot_id") REFERENCES "public"."price_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Immutable audit prices: daily bars may be revised, but execution snapshots may not.
CREATE FUNCTION stockdepth_immutable_price_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'price snapshots are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER price_snapshots_immutable BEFORE UPDATE OR DELETE ON price_snapshots FOR EACH ROW EXECUTE FUNCTION stockdepth_immutable_price_snapshot();
--> statement-breakpoint
CREATE FUNCTION stockdepth_paper_fill_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q price_snapshots%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.price_snapshot_id IS NOT NULL AND
    (NEW.price_snapshot_id IS DISTINCT FROM OLD.price_snapshot_id OR NEW.execution_price IS DISTINCT FROM OLD.execution_price OR
     NEW.price_cents IS DISTINCT FROM OLD.price_cents OR NEW.instrument_id IS DISTINCT FROM OLD.instrument_id OR
     NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.gross_amount_cents IS DISTINCT FROM OLD.gross_amount_cents) THEN
    RAISE EXCEPTION 'paper snapshot fill is immutable';
  END IF;
  IF NEW.price_snapshot_id IS NOT NULL THEN
    SELECT * INTO q FROM price_snapshots WHERE id=NEW.price_snapshot_id;
    IF q.id IS NULL OR NEW.instrument_id IS DISTINCT FROM q.instrument_id OR NEW.execution_price IS DISTINCT FROM q.price OR
       NEW.price_cents IS DISTINCT FROM round(q.price*100)::integer OR
       q.currency IS DISTINCT FROM (SELECT currency FROM paper_portfolios WHERE id=NEW.portfolio_id) THEN
      RAISE EXCEPTION 'paper fill snapshot mismatch';
    END IF;
  ELSIF NEW.execution_price IS NOT NULL THEN
    RAISE EXCEPTION 'paper execution price requires snapshot';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paper_trades_snapshot_fill BEFORE INSERT OR UPDATE ON paper_trades FOR EACH ROW EXECUTE FUNCTION stockdepth_paper_fill_snapshot();
