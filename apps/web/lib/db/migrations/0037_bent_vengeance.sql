ALTER TABLE "llm_model_configs" ADD COLUMN "unavailable_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "unavailable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "availability_checked_at" timestamp with time zone;