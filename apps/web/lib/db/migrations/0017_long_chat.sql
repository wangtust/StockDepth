CREATE TABLE "analysis_model_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"call_id" varchar(100) NOT NULL,
	"agent" varchar(160) NOT NULL,
	"model" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"status" varchar(30) NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"total_tokens" bigint,
	"usage_available" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "input_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "output_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "total_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "token_usage_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD CONSTRAINT "analysis_model_calls_job_id_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_model_calls_job_call_idx" ON "analysis_model_calls" USING btree ("job_id","call_id");