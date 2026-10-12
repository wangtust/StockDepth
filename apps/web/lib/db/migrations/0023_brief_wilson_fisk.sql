ALTER TABLE "analysis_worker_settings" ALTER COLUMN "system_concurrency" SET DEFAULT 200;--> statement-breakpoint
ALTER TABLE "analysis_worker_settings" ALTER COLUMN "user_concurrency" SET DEFAULT 5;
--> statement-breakpoint
INSERT INTO analysis_worker_settings (key, system_concurrency, user_concurrency)
VALUES ('analysis_worker', 200, 5) ON CONFLICT (key) DO NOTHING;
