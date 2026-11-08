import { sql } from 'drizzle-orm';

export const JOB_PAGE_SIZE = 20;

export function jobsPageQuery(userId: number, before?: number) {
  return sql`
    select
      (select analysis_credits from billing_accounts where user_id = ${userId}) as credits,
      coalesce((select jsonb_object_agg(depth, credit_cost) from analysis_pricing), '{}'::jsonb) as pricing,
      coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'modelName', v.model_name, 'provider', v.provider, 'isDefault', c.is_default,
        'quickEnabled', c.quick_enabled, 'deepEnabled', c.deep_enabled) order by c.is_default desc, c.id)
        from llm_model_configs c join llm_model_config_versions v on v.id=c.current_version_id and v.config_id=c.id
        where c.is_active and c.retired_at is null and c.unavailable_reason is null), '[]'::jsonb) as models,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', j.id, 'ticker', j.ticker, 'tradeDate', j.trade_date,
        'realtimeData', j.realtime_data, 'language', j.language, 'depth', j.depth,
        'quickModel', coalesce(qv.model_name,l.evidence->>'quickModel'), 'deepModel', coalesce(dv.model_name,l.evidence->>'deepModel'),
        'visibility', j.visibility, 'publicId', j.public_id,
        'status', j.status, 'inputTokens', j.input_tokens, 'outputTokens', j.output_tokens,
        'totalTokens', j.total_tokens, 'tokenUsageComplete', j.token_usage_complete,
        'startedAt', j.started_at at time zone 'UTC', 'completedAt', j.completed_at at time zone 'UTC',
        'createdAt', j.created_at at time zone 'UTC', 'updatedAt', j.updated_at at time zone 'UTC',
        'reportCount', (select count(*)::int from analysis_reports r where r.job_id = j.id and r.user_id = ${userId}),
        'defaultReportKey', (select r.report_key from analysis_reports r where r.job_id = j.id and r.user_id = ${userId}
          order by (r.report_key = 'progress') desc, r.id limit 1)
      ) order by j.id desc) from (
        select * from analysis_jobs where user_id = ${userId} and hidden_at is null
          ${before ? sql`and id < ${before}` : sql``}
        order by id desc limit ${JOB_PAGE_SIZE + 1}
      ) j left join llm_model_config_versions qv on qv.id=j.quick_model_version_id
        left join llm_model_config_versions dv on dv.id=j.deep_model_version_id
        left join analysis_job_legacy_configs l on l.job_id=j.id), '[]'::jsonb) as jobs
  `;
}
