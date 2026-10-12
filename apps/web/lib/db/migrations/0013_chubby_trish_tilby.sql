CREATE TABLE "paper_trade_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"paper_analysis_run_id" integer NOT NULL,
	"analysis_job_id" integer NOT NULL,
	"ticker" varchar(40) NOT NULL,
	"action" varchar(12) NOT NULL,
	"confidence_bps" integer DEFAULT 0 NOT NULL,
	"target_weight_bps" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"risk_notes" text,
	"raw_response" text,
	"status" varchar(30) DEFAULT 'proposed' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"executed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_trade_decisions_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_trade_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_trade_decisions_paper_analysis_run_id_paper_analysis_runs_id_fk" FOREIGN KEY ("paper_analysis_run_id") REFERENCES "public"."paper_analysis_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trade_decisions" ADD CONSTRAINT "paper_trade_decisions_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_trade_decisions_analysis_run_idx" ON "paper_trade_decisions" USING btree ("paper_analysis_run_id");--> statement-breakpoint
CREATE INDEX "paper_trade_decisions_portfolio_created_idx" ON "paper_trade_decisions" USING btree ("portfolio_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_trade_decisions_user_created_idx" ON "paper_trade_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_trade_decisions_status_idx" ON "paper_trade_decisions" USING btree ("status");