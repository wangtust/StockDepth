// Explicit job IDs only. Uses saved failure evidence; never calls a provider.
import {config} from '../apps/web/node_modules/dotenv';config({path:'.env'});
async function main() {
 const ids=process.argv.slice(2).map(Number);
 if(!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Provide failed analysis job IDs');
 const {db,client}=await import('../apps/web/lib/db/drizzle');
 const {analysisJobs,analysisModelCalls,llmModelConfigs}=await import('../apps/web/lib/db/schema');
 const {recordQuotaFailures}=await import('../apps/web/lib/analysis/model-availability');
 const {and,eq,inArray}=await import('../apps/web/node_modules/drizzle-orm');
 try {
  const jobs=await db.select().from(analysisJobs).where(and(inArray(analysisJobs.id,ids),eq(analysisJobs.status,'failed')));
  for(const job of jobs) {
   const calls=await db.select().from(analysisModelCalls).where(eq(analysisModelCalls.jobId,job.id));
   await recordQuotaFailures(job,calls.map(c=>({status:c.status,model:c.model,model_config_id:c.modelConfigId,model_version_id:c.modelVersionId,ended_at:c.endedAt?.toISOString()})),job.errorMessage||undefined);
  }
  const {loadModelConfigs}=await import('../apps/web/lib/analysis/model-versions');
  const unavailable=(await loadModelConfigs(db,eq(llmModelConfigs.unavailableReason,'quota_exhausted'))).map(c=>({id:c.id,name:c.name,model:c.modelName,reason:c.unavailableReason}));
  console.log(JSON.stringify({reviewed:jobs.length,unavailable}));
 }finally{await client.end();}
}
main().catch(()=>{console.error('Quota status backfill failed');process.exitCode=1;});
