CREATE TABLE "analysis_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"action" varchar(8),
	"summary" text,
	"extraction_status" varchar(20) NOT NULL,
	"extraction_version" integer DEFAULT 1 NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_decisions_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "analysis_decisions_action_valid" CHECK ("analysis_decisions"."action" in ('buy','sell','hold')),
	CONSTRAINT "analysis_decisions_status_valid" CHECK ("analysis_decisions"."extraction_status" in ('pending','succeeded','unrecognized','failed'))
);
--> statement-breakpoint
ALTER TABLE "analysis_decisions" ADD CONSTRAINT "analysis_decisions_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_jobs_user_instrument_date_idx" ON "analysis_jobs" USING btree ("user_id","instrument_id","trade_date") WHERE hidden_at is null;