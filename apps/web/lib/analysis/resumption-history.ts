import {sql} from 'drizzle-orm';

// Public projection: expose model names only, never historical snapshots or keys.
export function resumptionHistory(userId:number) {
  return sql`coalesce((select json_agg(json_build_object('id', h.id,
        'previousQuickModel', coalesce(pq.model_name, h.legacy_evidence->>'previousQuickModel'),
        'previousDeepModel', coalesce(pd.model_name, h.legacy_evidence->>'previousDeepModel'),
        'nextQuickModel', coalesce(nq.model_name, h.legacy_evidence->>'nextQuickModel'),
        'nextDeepModel', coalesce(nd.model_name, h.legacy_evidence->>'nextDeepModel'),
        'createdAt', h.created_at) order by h.id)
        from analysis_job_resumptions h
        left join llm_model_config_versions pq on pq.id = h.previous_quick_version_id
        left join llm_model_config_versions pd on pd.id = h.previous_deep_version_id
        left join llm_model_config_versions nq on nq.id = h.next_quick_version_id
        left join llm_model_config_versions nd on nd.id = h.next_deep_version_id
        where h.job_id = analysis_jobs.id and h.user_id = ${userId}), '[]'::json)`;
}
