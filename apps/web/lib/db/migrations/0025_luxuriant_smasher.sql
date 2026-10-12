-- Enforce future writes without scanning or rewriting historical trading data.
-- CHECK constraints are intentionally NOT VALID; validation is a separate audited task.
CREATE TABLE "paper_trade_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"portfolio_id" integer NOT NULL,
	"key" uuid NOT NULL,
	"request" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "decision_id" integer;--> statement-breakpoint
ALTER TABLE "paper_trade_requests" ADD CONSTRAINT "paper_trade_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_requests" ADD CONSTRAINT "paper_trade_requests_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_trade_requests_scope_key_idx" ON "paper_trade_requests" USING btree ("user_id","portfolio_id","key");--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_decision_id_paper_trade_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."paper_trade_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_trades_decision_idx" ON "paper_trades" USING btree ("decision_id");--> statement-breakpoint
ALTER TABLE "paper_portfolios" ADD CONSTRAINT "paper_portfolios_cash_nonnegative" CHECK ("paper_portfolios"."cash_cents" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_amounts_nonnegative" CHECK ("paper_positions"."quantity" >= 0 AND "paper_positions"."avg_cost_cents" >= 0 AND "paper_positions"."last_price_cents" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_amounts_valid" CHECK ("paper_trades"."quantity" > 0 AND "paper_trades"."price_cents" > 0 AND "paper_trades"."gross_amount_cents"::bigint = "paper_trades"."quantity"::bigint * "paper_trades"."price_cents"::bigint AND "paper_trades"."fee_cents" >= 0) NOT VALID;