ALTER TABLE "llm_model_configs" ADD COLUMN "model_name" varchar(160);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "input_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "cache_price" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "llm_model_configs" ADD COLUMN "output_price" numeric(15, 6);--> statement-breakpoint
UPDATE llm_model_configs SET model_name = quick_model,
 input_price = coalesce(quick_input_price, CASE WHEN quick_model = deep_model THEN deep_input_price END),
 cache_price = coalesce(quick_cache_price, CASE WHEN quick_model = deep_model THEN deep_cache_price END),
 output_price = coalesce(quick_output_price, CASE WHEN quick_model = deep_model THEN deep_output_price END);
--> statement-breakpoint
INSERT INTO llm_model_configs (name, provider, base_url, api_key, quick_model, deep_model, model_name,
 input_price, cache_price, output_price, is_default, is_active, created_at, updated_at)
SELECT left(name || ' · ' || deep_model, 120), provider, base_url, api_key, deep_model, deep_model, deep_model,
 deep_input_price, deep_cache_price, deep_output_price, false, is_active, created_at, updated_at
FROM llm_model_configs WHERE quick_model <> deep_model;
--> statement-breakpoint
ALTER TABLE llm_model_configs ALTER COLUMN model_name SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "quick_model";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "deep_model";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "quick_input_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "quick_cache_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "quick_output_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "deep_input_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "deep_cache_price";--> statement-breakpoint
ALTER TABLE "llm_model_configs" DROP COLUMN "deep_output_price";