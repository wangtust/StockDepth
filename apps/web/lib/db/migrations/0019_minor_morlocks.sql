ALTER TABLE "analysis_model_calls" ADD COLUMN "cached_input_tokens" bigint;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "raw_usage" text;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "pricing_snapshot" text;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "estimated_cost" numeric(24, 12);--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "cost_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "quick_input_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "quick_cache_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "quick_output_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "deep_input_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "deep_cache_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "deep_output_price" numeric(15, 6);