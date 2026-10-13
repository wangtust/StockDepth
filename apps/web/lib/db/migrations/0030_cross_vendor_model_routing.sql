ALTER TABLE "analysis_jobs" ADD COLUMN "quick_model_config_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "deep_model_config_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "quick_config_snapshot" text;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "deep_config_snapshot" text;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "role" varchar(20) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "model_config_id" integer;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "provider" varchar(80);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "quick_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "deep_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_quick_model_config_id_llm_model_configs_id_fk" FOREIGN KEY ("quick_model_config_id") REFERENCES "public"."llm_model_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_deep_model_config_id_llm_model_configs_id_fk" FOREIGN KEY ("deep_model_config_id") REFERENCES "public"."llm_model_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "analysis_jobs" SET "quick_model_config_id" = "model_config_id", "deep_model_config_id" = "model_config_id" WHERE "model_config_id" IS NOT NULL;
