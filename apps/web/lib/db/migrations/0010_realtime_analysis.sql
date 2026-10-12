ALTER TABLE "analysis_jobs"
ADD COLUMN IF NOT EXISTS "realtime_data" boolean DEFAULT false NOT NULL;
