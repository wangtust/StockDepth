CREATE TABLE "paper_analysis_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"watchlist_item_id" integer,
	"analysis_job_id" integer NOT NULL,
	"ticker" varchar(40) NOT NULL,
	"context" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_analysis_runs_portfolio_id_paper_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."paper_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_analysis_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_analysis_runs_watchlist_item_id_watchlist_items_id_fk" FOREIGN KEY ("watchlist_item_id") REFERENCES "public"."watchlist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD CONSTRAINT "paper_analysis_runs_analysis_job_id_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_analysis_runs_job_idx" ON "paper_analysis_runs" USING btree ("analysis_job_id");--> statement-breakpoint
CREATE INDEX "paper_analysis_runs_portfolio_created_idx" ON "paper_analysis_runs" USING btree ("portfolio_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_analysis_runs_user_created_idx" ON "paper_analysis_runs" USING btree ("user_id","created_at");