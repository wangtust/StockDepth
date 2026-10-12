CREATE TABLE IF NOT EXISTS "analysis_worker_settings" (
  "key" varchar(50) PRIMARY KEY NOT NULL,
  "system_concurrency" integer NOT NULL DEFAULT 1,
  "user_concurrency" integer NOT NULL DEFAULT 1,
  "updated_at" timestamp DEFAULT now() NOT NULL
);