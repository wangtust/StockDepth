ALTER TABLE "analysis_job_resumptions" ADD COLUMN "legacy_evidence" jsonb;--> statement-breakpoint
-- Preserve the exact pre-normalization audit evidence, including malformed/unknown
-- historical snapshots. New versioned rows do not duplicate immutable model data.
UPDATE analysis_job_resumptions SET legacy_evidence = jsonb_build_object(
  'previousQuickModel', previous_quick_model,
  'previousQuickConfigSnapshot', previous_quick_config_snapshot,
  'previousDeepModel', previous_deep_model,
  'previousDeepConfigSnapshot', previous_deep_config_snapshot,
  'nextQuickModel', next_quick_model,
  'nextQuickConfigSnapshot', next_quick_config_snapshot,
  'nextDeepModel', next_deep_model,
  'nextDeepConfigSnapshot', next_deep_config_snapshot);
--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "previous_quick_model";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "previous_deep_model";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "next_quick_model";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "next_deep_model";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "previous_quick_config_snapshot";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "previous_deep_config_snapshot";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "next_quick_config_snapshot";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" DROP COLUMN "next_deep_config_snapshot";--> statement-breakpoint
ALTER TABLE "analysis_job_resumptions" ADD CONSTRAINT "analysis_resumptions_legacy_evidence_object" CHECK ("analysis_job_resumptions"."legacy_evidence" IS NULL OR jsonb_typeof("analysis_job_resumptions"."legacy_evidence") = 'object');