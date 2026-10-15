import { sql } from 'drizzle-orm';

export const JOB_PAGE_SIZE = 20;

export function jobsPageQuery(userId: number, before?: number) {
  return sql`
    select
      (select analysis_credits from users where id = ${userId}) as credits,
      coalesce((select jsonb_object_agg(depth, credit_cost) from analysis_pricing), '{}'::jsonb) as pricing,
      coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name,
        'modelName', model_name, 'provider', provider, 'isDefault', is_default,
        'quickEnabled', quick_enabled, 'deepEnabled', deep_enabled) order by is_default desc, id)
        from llm_model_configs where is_active and retired_at is null and unavailable_reason is null), '[]'::jsonb) as models,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', j.id, 'ticker', j.ticker, 'tradeDate', j.trade_date,
        'realtimeData', j.realtime_data, 'language', j.language, 'depth', j.depth,
        'quickModel', j.quick_model, 'deepModel', j.deep_model,
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
      ) j), '[]'::jsonb) as jobs
  `;
}
