ALTER TABLE "analysis_jobs" ADD COLUMN "worker_owner" varchar(100);--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "worker_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD COLUMN "processing_state" varchar(30) DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD COLUMN "worker_owner" varchar(100);--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD COLUMN "worker_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD COLUMN "model_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_analysis_runs" ADD COLUMN "model_call_id" varchar(100);--> statement-breakpoint
ALTER TABLE "paper_model_calls" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
UPDATE "paper_analysis_runs" p SET "processing_state" = 'complete' WHERE EXISTS (SELECT 1 FROM "paper_trade_decisions" d WHERE d."paper_analysis_run_id" = p."id");
