-- Preserve existing data; any integrity violation aborts the migration.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_job_owner_fk" FOREIGN KEY ("job_id","user_id") REFERENCES "public"."analysis_jobs"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_job_owner_fk" FOREIGN KEY ("job_id","user_id") REFERENCES "public"."analysis_jobs"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_reports_job_key_idx" ON "analysis_reports" USING btree ("job_id","report_key");--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_trade_date_valid" CHECK (CASE WHEN "analysis_jobs"."trade_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN ("analysis_jobs"."trade_date"::date IS NOT NULL) ELSE false END);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_analysis_credits_nonnegative" CHECK ("users"."analysis_credits" >= 0);
--> statement-breakpoint
-- Validate previously deferred checks individually; no historical cleanup.
ALTER TABLE public."paper_analysis_runs" VALIDATE CONSTRAINT "paper_runs_job_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_analysis_runs" VALIDATE CONSTRAINT "paper_runs_portfolio_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_analysis_runs" VALIDATE CONSTRAINT "paper_runs_watchlist_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_portfolios" VALIDATE CONSTRAINT "paper_portfolios_cashCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_portfolios" VALIDATE CONSTRAINT "paper_portfolios_cash_nonnegative";
--> statement-breakpoint
ALTER TABLE public."paper_portfolios" VALIDATE CONSTRAINT "paper_portfolios_initialCashCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_positions" VALIDATE CONSTRAINT "paper_positions_amounts_nonnegative";
--> statement-breakpoint
ALTER TABLE public."paper_positions" VALIDATE CONSTRAINT "paper_positions_avgCostCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_positions" VALIDATE CONSTRAINT "paper_positions_lastPriceCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_positions" VALIDATE CONSTRAINT "paper_positions_portfolio_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_positions" VALIDATE CONSTRAINT "paper_positions_realizedPnlCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_trade_decisions" VALIDATE CONSTRAINT "paper_decisions_portfolio_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_trade_decisions" VALIDATE CONSTRAINT "paper_decisions_run_scope_job_fk";
--> statement-breakpoint
ALTER TABLE public."paper_trade_decisions" VALIDATE CONSTRAINT "paper_trade_decisions_priceCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_trade_requests" VALIDATE CONSTRAINT "paper_requests_portfolio_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_amounts_valid";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_decision_scope_fk";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_feeCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_grossAmountCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_portfolio_owner_fk";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_position_scope_fk";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_priceCents_safe";
--> statement-breakpoint
ALTER TABLE public."paper_trades" VALIDATE CONSTRAINT "paper_trades_realizedPnlCents_safe";
