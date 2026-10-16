import { and, eq, inArray, isNull, isNotNull, sql, asc } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { analysisJobs, llmModelConfigs } from '../db/schema';

// Explicit billing/quota evidence only. HTTP 429 rate limits and network failures
// must not make a model permanently unavailable.
export function isQuotaExhausted(message: string) {
  return /insufficient_quota|quota_exhausted|401008|free trial quota.*exhausted|insufficient (?:account )?(?:balance|credits)|credit balance.*(?:too low|insufficient)|(?:余额|额度|配额).{0,12}(?:不足|耗尽|用尽)|billing_hard_limit_reached/i.test(message);
}
type Snapshot = Pick<typeof llmModelConfigs.$inferSelect,'id'|'provider'|'modelName'|'baseUrl'> & {updatedAt:Date|string};
type Job = Pick<typeof analysisJobs.$inferSelect,'quickConfigSnapshot'|'deepConfigSnapshot'>;
type FailedCall = {status:string;model:string;model_config_id?:number|null;ended_at?:string|null;failure_reason?:string|null};
function snapshots(job:Job):Snapshot[] {
  return [job.quickConfigSnapshot,job.deepConfigSnapshot].flatMap(value=>{try{return value?[JSON.parse(value)]:[];}catch{return [];}});
}
export async function markModelQuotaUnavailable(snapshot:Snapshot,eventAt=new Date()) {
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(739421, 3)`);
    const rows=await tx.select().from(llmModelConfigs).orderBy(asc(llmModelConfigs.id)).for('update');
    const current=rows.find(row=>row.id===snapshot.id);
    if (!current || current.retiredAt || current.modelName!==snapshot.modelName || current.provider!==snapshot.provider || current.baseUrl!==snapshot.baseUrl || current.updatedAt.getTime()!==new Date(snapshot.updatedAt).getTime()) return false;
    if (!Number.isFinite(eventAt.getTime()) || (current.availabilityCheckedAt && eventAt<=current.availabilityCheckedAt)) return false;
    if (current.unavailableReason!=='quota_exhausted') await tx.update(llmModelConfigs).set({unavailableReason:'quota_exhausted',unavailableAt:eventAt}).where(eq(llmModelConfigs.id,current.id));
    const available=rows.filter(row=>row.id!==current.id&&row.isActive&&!row.retiredAt&&!row.unavailableReason&&(row.quickEnabled||row.deepEnabled));
    const next=available.find(row=>row.isDefault)??available.find(row=>row.quickEnabled&&row.deepEnabled)??available.find(row=>row.quickEnabled||row.deepEnabled);
    const defaults=rows.filter(row=>row.isDefault);
    if(defaults.length!==(next?1:0)||defaults[0]?.id!==next?.id) {
      await tx.update(llmModelConfigs).set({isDefault:false}).where(eq(llmModelConfigs.isDefault,true));
      if(next)await tx.update(llmModelConfigs).set({isDefault:true}).where(eq(llmModelConfigs.id,next.id));
    }
    return true;
  });
}
export async function recordQuotaFailures(job:Job,calls:FailedCall[],fatalLog?:string) {
  const explicit=calls.filter(call=>call.status==='failed'&&call.failure_reason==='quota_exhausted');
  // Old runners do not record a failure category. Only attribute a fatal quota
  // error to the latest failed call, never to both Quick and Deep by assumption.
  let failures=explicit;
  if (!failures.length && fatalLog) {
    const fatal=fatalLog.split('\n').filter(line=>/Analysis failed:/.test(line)).at(-1);
    if (fatal&&isQuotaExhausted(fatal)) {
      const ordered=calls.filter(c=>c.status==='failed'&&c.ended_at).sort((a,b)=>Date.parse(b.ended_at!)-Date.parse(a.ended_at!));
      if(ordered[0])failures=ordered.filter(c=>c.ended_at===ordered[0].ended_at);
    }
  }
  for(const failure of failures) {
    const candidates=[...new Map(snapshots(job).filter(s=>s.modelName===failure.model&&(!failure.model_config_id||s.id===failure.model_config_id)).map(s=>[s.id,s])).values()];
    if(candidates.length===1)await markModelQuotaUnavailable(candidates[0],failure.ended_at?new Date(failure.ended_at):new Date());
  }
}
export async function unavailableJobModels(job:Job,reader:Pick<typeof db,'select'>=db) {
  const expected=snapshots(job);if(!expected.length)return [];
  const rows=await reader.select().from(llmModelConfigs).where(and(inArray(llmModelConfigs.id,expected.map(s=>s.id)),isNotNull(llmModelConfigs.unavailableReason),isNull(llmModelConfigs.retiredAt)));
  return rows.filter(row=>expected.some(s=>s.id===row.id&&row.updatedAt.getTime()===new Date(s.updatedAt).getTime()));
}
