CREATE TABLE "analysis_retry_schedule" (
  "key" text PRIMARY KEY NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analysis_jobs_failed_retry_idx" ON "analysis_jobs" (coalesce("completed_at", "updated_at")) WHERE "status" = 'failed' AND "hidden_at" IS NULL;
