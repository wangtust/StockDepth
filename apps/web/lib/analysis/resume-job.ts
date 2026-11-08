import {pinModelVersions,readModelVersion,ModelSelectionError} from './model-versions';
import {and,eq,isNull,desc,asc,sql} from 'drizzle-orm';
import {db} from '../db/drizzle';
import {analysisJobs,analysisJobLegacyConfigs,analysisJobResumptions,llmModelConfigs} from '../db/schema';
import {encryptedHistoricalSnapshot} from './model-snapshot';
import {unavailableJobModels} from './model-availability';
export type ReplacementModels={quickModelConfigId:number;deepModelConfigId:number};
export async function resumeAnalysisJob(userId:number,jobId:number,replacement?:ReplacementModels, autoOwner?:string) {
  return db.transaction(tx=>resumeAnalysisJobInTransaction(tx,userId,jobId,replacement,autoOwner));
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function resumeAnalysisJobInTransaction(tx:Transaction,userId:number,jobId:number,replacement?:ReplacementModels,autoOwner?:string,scheduled=false) {
  const [existing]=await tx.select().from(analysisJobs).where(and(eq(analysisJobs.id,jobId),eq(analysisJobs.userId,userId),isNull(analysisJobs.hiddenAt))).for('update');
  if(!existing||(autoOwner ? existing.status!=='running'||existing.workerOwner!==autoOwner||!existing.workerLeaseUntil||existing.workerLeaseUntil<=new Date() : existing.status!=='failed'))return {error:'Only failed analysis jobs can be continued',status:409} as const;
  let quickVersion:Awaited<ReturnType<typeof readModelVersion>>|null;
  let deepVersion:Awaited<ReturnType<typeof readModelVersion>>|null;
  try {
    quickVersion=existing.quickModelVersionId ? await readModelVersion(tx,existing.quickModelVersionId) : null;
    deepVersion=existing.deepModelVersionId ? await readModelVersion(tx,existing.deepModelVersionId) : null;
  } catch(error) {
    if(scheduled && error instanceof Error && ['Pinned model version unavailable','Model key unavailable or invalid'].includes(error.message))
      return {error:'Pinned model credentials unavailable',status:409} as const;
    throw error;
  }
  const [legacy]=(!quickVersion || !deepVersion) ? await tx.select().from(analysisJobLegacyConfigs).where(eq(analysisJobLegacyConfigs.jobId,jobId)) : [];
  const historical=legacy?.evidence || {};
  let changed:Partial<typeof analysisJobs.$inferInsert>={};
  if(autoOwner) {
    const blocked=await unavailableJobModels(existing,tx);
    if(!blocked.length)return {error:'No unavailable model to replace',status:409} as const;
    const prior=await tx.select({id:analysisJobResumptions.id}).from(analysisJobResumptions).where(and(eq(analysisJobResumptions.jobId,jobId),sql`(${analysisJobResumptions.previousQuickVersionId} is distinct from ${analysisJobResumptions.nextQuickVersionId} or ${analysisJobResumptions.previousDeepVersionId} is distinct from ${analysisJobResumptions.nextDeepVersionId})`));
    // Only actual version replacements consume the budget; scheduled continuations do not.
    // Existing manual replacements also consume this conservative per-job budget.
    if(prior.length>=3)return {error:'The automatic model replacement limit of three has been reached. Select models manually to continue.',status:422} as const;
    await tx.execute(sql`select pg_advisory_xact_lock(739421, 3)`);
    const available=await tx.select().from(llmModelConfigs).where(and(eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason))).orderBy(desc(llmModelConfigs.isDefault),asc(llmModelConfigs.id));
    if(!available.some(c=>c.isDefault)) {
      const next=available.find(c=>c.quickEnabled&&c.deepEnabled)??available.find(c=>c.quickEnabled||c.deepEnabled);
      await tx.update(llmModelConfigs).set({isDefault:false}).where(eq(llmModelConfigs.isDefault,true));
      if(next){await tx.update(llmModelConfigs).set({isDefault:true}).where(eq(llmModelConfigs.id,next.id));available.sort((a,b)=>Number(b.id===next.id)-Number(a.id===next.id));}
    }
    const quick=available.find(c=>c.id===quickVersion?.id&&c.quickEnabled)??available.find(c=>c.quickEnabled);
    const deep=available.find(c=>c.id===deepVersion?.id&&c.deepEnabled)??available.find(c=>c.deepEnabled);
    if(!quick||!deep)return {error:'No replacement Quick / Deep models are available. The job has stopped.',status:503} as const;
    replacement={quickModelConfigId:quick.id,deepModelConfigId:deep.id};
  }

  if(replacement) {
    const selection=replacement;
    let pinned;
    try { pinned=await pinModelVersions(tx,{id:selection.quickModelConfigId},{id:selection.deepModelConfigId}); }
    catch(error) { if(error instanceof ModelSelectionError)return {error:error.message,status:400} as const; throw error; }
    await tx.insert(analysisJobResumptions).values({jobId,userId,
      previousQuickVersionId:existing.quickModelVersionId,previousDeepVersionId:existing.deepModelVersionId,
      nextQuickVersionId:pinned.quickModelVersionId,nextDeepVersionId:pinned.deepModelVersionId,
      configurationState:'versioned',initiator:autoOwner?'automatic':'user',
      legacyEvidence: !quickVersion || !deepVersion ? {
        ...(!quickVersion ? {previousQuickModel:historical.quickModel ?? null,
          previousQuickConfigSnapshot:encryptedHistoricalSnapshot((historical.quickConfigSnapshot as string|null) ?? null)} : {}),
        ...(!deepVersion ? {previousDeepModel:historical.deepModel ?? null,
          previousDeepConfigSnapshot:encryptedHistoricalSnapshot((historical.deepConfigSnapshot as string|null) ?? null)} : {})
      } : null});
    changed=pinned;
  }else if(!quickVersion || !deepVersion) {
    return {error:'This older job has no reliable model version. Select models to continue.',status:409} as const;
  }else if((await unavailableJobModels(existing,tx)).length) {
    return {error:'The model is unavailable. Use "Change models and continue" or ask an administrator to restore it.',status:409} as const;
  }
  if(scheduled) {
    await tx.insert(analysisJobResumptions).values({jobId,userId,
      previousQuickVersionId:existing.quickModelVersionId,previousDeepVersionId:existing.deepModelVersionId,
      nextQuickVersionId:existing.quickModelVersionId,nextDeepVersionId:existing.deepModelVersionId,
      configurationState:'versioned',initiator:'automatic'});
  }
  const [job]=await tx.update(analysisJobs).set({...changed,status:'queued',workerOwner:null,workerLeaseUntil:null,externalStatus:'resume-queued',externalPid:null,errorMessage:null,completedAt:null,updatedAt:new Date()})
    .where(eq(analysisJobs.id,existing.id)).returning();
  return {job,status:200} as const;
}
