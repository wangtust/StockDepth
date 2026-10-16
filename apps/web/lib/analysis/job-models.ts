import { sql } from 'drizzle-orm';
import { analysisJobs } from '@/lib/db/schema';

// Display-only projections: version references remain the only execution input.
// Legacy evidence is never substituted for a reliable pinned version.
export const jobModelFields = {
  provider: sql<string | null>`coalesce((select v.provider from llm_model_config_versions v where v.id = ${analysisJobs.quickModelVersionId}), (select l.evidence->>'provider' from analysis_job_legacy_configs l where l.job_id = ${analysisJobs.id}))`,
  quickModel: sql<string | null>`coalesce((select v.model_name from llm_model_config_versions v where v.id = ${analysisJobs.quickModelVersionId}), (select l.evidence->>'quickModel' from analysis_job_legacy_configs l where l.job_id = ${analysisJobs.id}))`,
  deepModel: sql<string | null>`coalesce((select v.model_name from llm_model_config_versions v where v.id = ${analysisJobs.deepModelVersionId}), (select l.evidence->>'deepModel' from analysis_job_legacy_configs l where l.job_id = ${analysisJobs.id}))`,
  quickModelConfigId: sql<number | null>`(select v.config_id from llm_model_config_versions v where v.id = ${analysisJobs.quickModelVersionId})`,
  deepModelConfigId: sql<number | null>`(select v.config_id from llm_model_config_versions v where v.id = ${analysisJobs.deepModelVersionId})`,
};
