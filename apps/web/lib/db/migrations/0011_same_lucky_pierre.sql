CREATE TABLE "paper_portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(120) DEFAULT 'Paper Portfolio' NOT NULL,
	"initial_cash_cents" integer NOT NULL,
	"cash_cents" integer NOT NULL,
	"currency" varchar(12) DEFAULT 'USD' NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"ticker" varchar(40) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"avg_cost_cents" integer DEFAULT 0 NOT NULL,
	"last_price_cents" integer DEFAULT 0 NOT NULL,
	"realized_pnl_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"position_id" integer,
	"ticker" varchar(40) NOT NULL,
	"side" varchar(12) NOT NULL,
	"quantity" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"gross_amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"realized_pnl_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ticker" varchar(40) NOT NULL,
	"market" varchar(40),
	"name" varchar(160),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_portfolios" ADD CONSTRAINT "paper_portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_position_id_paper_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."paper_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_portfolios_user_status_idx" ON "paper_portfolios" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_portfolio_ticker_idx" ON "paper_positions" USING btree ("portfolio_id","ticker");--> statement-breakpoint
CREATE INDEX "paper_positions_user_idx" ON "paper_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paper_trades_portfolio_created_idx" ON "paper_trades" USING btree ("portfolio_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_trades_user_created_idx" ON "paper_trades" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_user_ticker_idx" ON "watchlist_items" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE INDEX "watchlist_items_user_active_idx" ON "watchlist_items" USING btree ("user_id","is_active");
