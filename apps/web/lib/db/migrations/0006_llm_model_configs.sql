CREATE TABLE IF NOT EXISTS "llm_model_configs" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(120) NOT NULL,
  "provider" varchar(80) NOT NULL,
  "base_url" text NOT NULL,
  "api_key" text NOT NULL,
  "quick_model" varchar(160) NOT NULL,
  "deep_model" varchar(160) NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN IF NOT EXISTS "model_config_id" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analysis_jobs_model_config_id_llm_model_configs_id_fk'
  ) THEN
    ALTER TABLE "analysis_jobs"
    ADD CONSTRAINT "analysis_jobs_model_config_id_llm_model_configs_id_fk"
    FOREIGN KEY ("model_config_id") REFERENCES "public"."llm_model_configs"("id");
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "llm_model_configs" (
  "name",
  "provider",
  "base_url",
  "api_key",
  "quick_model",
  "deep_model",
  "is_default",
  "is_active"
)
SELECT
  'Qwen DashScope Singapore',
  'qwen',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  '',
  'qwen-plus',
  'qwen-plus',
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM "llm_model_configs");
