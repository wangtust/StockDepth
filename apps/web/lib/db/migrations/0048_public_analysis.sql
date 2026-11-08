ALTER TABLE "analysis_jobs" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "analysis_jobs_public_page_idx" ON "analysis_jobs" USING btree ("published_at","public_id") WHERE "analysis_jobs"."visibility" = 'public' and "analysis_jobs"."status" = 'complete' and "analysis_jobs"."hidden_at" is null;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_visibility_valid" CHECK ("analysis_jobs"."visibility" in ('private','public'));