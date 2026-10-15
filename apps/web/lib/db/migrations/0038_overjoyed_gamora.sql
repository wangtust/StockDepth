CREATE TABLE "analysis_job_resumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"previous_quick_model" varchar(160),
	"previous_deep_model" varchar(160),
	"next_quick_model" varchar(160) NOT NULL,
	"next_deep_model" varchar(160) NOT NULL,
	"previous_quick_config_snapshot" text,
	"previous_deep_config_snapshot" text,
	"next_quick_config_snapshot" text NOT NULL,
	"next_deep_config_snapshot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_job_resumptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_resumptions_job_owner_fk" FOREIGN KEY ("job_id","user_id") REFERENCES "public"."analysis_jobs"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_resumptions_job_created_idx" ON "analysis_job_resumptions" USING btree ("job_id","created_at");