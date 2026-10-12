-- Amount widening preserves values. New checks/FKs intentionally NOT VALID; no historical validation or cleanup.
CREATE UNIQUE INDEX "analysis_jobs_id_owner_idx" ON "analysis_jobs" USING btree ("id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "paper_analysis_runs_id_scope_job_idx" ON "paper_analysis_runs" USING btree ("id","portfolio_id","user_id","analysis_job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "paper_portfolios_id_owner_idx" ON "paper_portfolios" USING btree ("id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_id_scope_idx" ON "paper_positions" USING btree ("id","portfolio_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "paper_decisions_id_scope_idx" ON "paper_trade_decisions" USING btree ("id","portfolio_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_id_owner_idx" ON "watchlist_items" USING btree ("id","user_id");
--> statement-breakpoint
ALTER TABLE "paper_portfolios" ALTER COLUMN "initial_cash_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_portfolios" ALTER COLUMN "cash_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_positions" ALTER COLUMN "avg_cost_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_positions" ALTER COLUMN "last_price_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_positions" ALTER COLUMN "realized_pnl_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ALTER COLUMN "price_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_trades" ALTER COLUMN "price_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_trades" ALTER COLUMN "gross_amount_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_trades" ALTER COLUMN "fee_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_trades" ALTER COLUMN "realized_pnl_cents" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_runs_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."paper_portfolios"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_runs_job_owner_fk" FOREIGN KEY ("analysis_job_id","user_id") REFERENCES "public"."analysis_jobs"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_runs_watchlist_owner_fk" FOREIGN KEY ("watchlist_item_id","user_id") REFERENCES "public"."watchlist_items"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."paper_portfolios"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_decisions_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."paper_portfolios"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_decisions_run_scope_job_fk" FOREIGN KEY ("paper_analysis_run_id","portfolio_id","user_id","analysis_job_id") REFERENCES "public"."paper_analysis_runs"("id","portfolio_id","user_id","analysis_job_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trade_requests" ADD CONSTRAINT "paper_requests_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."paper_portfolios"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."paper_portfolios"("id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_position_scope_fk" FOREIGN KEY ("position_id","portfolio_id","user_id") REFERENCES "public"."paper_positions"("id","portfolio_id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_decision_scope_fk" FOREIGN KEY ("decision_id","portfolio_id","user_id") REFERENCES "public"."paper_trade_decisions"("id","portfolio_id","user_id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_portfolios" ADD CONSTRAINT "paper_portfolios_initialCashCents_safe" CHECK ("paper_portfolios"."initial_cash_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_portfolios" ADD CONSTRAINT "paper_portfolios_cashCents_safe" CHECK ("paper_portfolios"."cash_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_avgCostCents_safe" CHECK ("paper_positions"."avg_cost_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_lastPriceCents_safe" CHECK ("paper_positions"."last_price_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_realizedPnlCents_safe" CHECK ("paper_positions"."realized_pnl_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_trade_decisions_priceCents_safe" CHECK ("paper_trade_decisions"."price_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_priceCents_safe" CHECK ("paper_trades"."price_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_grossAmountCents_safe" CHECK ("paper_trades"."gross_amount_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_feeCents_safe" CHECK ("paper_trades"."fee_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_realizedPnlCents_safe" CHECK ("paper_trades"."realized_pnl_cents" BETWEEN -9007199254740991 AND 9007199254740991) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stockdepth_paper_fill_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
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
       NEW.price_cents IS DISTINCT FROM round(q.price*100)::bigint OR
       q.currency IS DISTINCT FROM (SELECT currency FROM paper_portfolios WHERE id=NEW.portfolio_id) THEN
      RAISE EXCEPTION 'paper fill snapshot mismatch';
    END IF;
  ELSIF NEW.execution_price IS NOT NULL THEN
    RAISE EXCEPTION 'paper execution price requires snapshot';
  END IF;
  RETURN NEW;
END $$;
