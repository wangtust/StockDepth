ALTER TABLE "analysis_jobs" ADD COLUMN "run_id" varchar(120);--> statement-breakpoint
UPDATE "analysis_jobs" SET "run_id" = CONCAT('legacy-job-', "id") WHERE "run_id" IS NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_run_id_unique" UNIQUE("run_id");
