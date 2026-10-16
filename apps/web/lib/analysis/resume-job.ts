import {pinModelVersions,readModelVersion,ModelSelectionError} from './model-versions';
import {and,eq,isNull,desc,asc,sql} from 'drizzle-orm';
import {db} from '../db/drizzle';
import {analysisJobs,analysisJobLegacyConfigs,analysisJobResumptions,llmModelConfigs} from '../db/schema';
import {immutableModelSnapshot,encryptedHistoricalSnapshot} from './model-snapshot';
import {unavailableJobModels} from './model-availability';
export type ReplacementModels={quickModelConfigId:number;deepModelConfigId:number};
export async function resumeAnalysisJob(userId:number,jobId:number,replacement?:ReplacementModels, autoOwner?:string) {
  return db.transaction(async tx=>{
    const [existing]=await tx.select().from(analysisJobs).where(and(eq(analysisJobs.id,jobId),eq(analysisJobs.userId,userId),isNull(analysisJobs.hiddenAt))).for('update');
    if(!existing||(autoOwner ? existing.status!=='running'||existing.workerOwner!==autoOwner||!existing.workerLeaseUntil||existing.workerLeaseUntil<=new Date() : existing.status!=='failed'))return {error:'Only failed analysis jobs can be continued',status:409} as const;
    const quickVersion=existing.quickModelVersionId ? await readModelVersion(tx,existing.quickModelVersionId) : null;
    const deepVersion=existing.deepModelVersionId ? await readModelVersion(tx,existing.deepModelVersionId) : null;
    const [legacy]=(!quickVersion || !deepVersion) ? await tx.select().from(analysisJobLegacyConfigs).where(eq(analysisJobLegacyConfigs.jobId,jobId)) : [];
    const historical=legacy?.evidence || {};
    let changed:Partial<typeof analysisJobs.$inferInsert>={};
    if(autoOwner) {
      const blocked=await unavailableJobModels(existing,tx);
      if(!blocked.length)return {error:'No unavailable model to replace',status:409} as const;
      const prior=await tx.select({id:analysisJobResumptions.id}).from(analysisJobResumptions).where(eq(analysisJobResumptions.jobId,jobId));
      // Existing manual replacements also consume this conservative per-job budget.
      if(prior.length>=3)return {error:'自动换模重试已达上限（最多三次换模），请手动选择模型后继续。',status:422} as const;
      await tx.execute(sql`select pg_advisory_xact_lock(739421, 3)`);
      const available=await tx.select().from(llmModelConfigs).where(and(eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason))).orderBy(desc(llmModelConfigs.isDefault),asc(llmModelConfigs.id));
      if(!available.some(c=>c.isDefault)) {
        const next=available.find(c=>c.quickEnabled&&c.deepEnabled)??available.find(c=>c.quickEnabled||c.deepEnabled);
        await tx.update(llmModelConfigs).set({isDefault:false}).where(eq(llmModelConfigs.isDefault,true));
        if(next){await tx.update(llmModelConfigs).set({isDefault:true}).where(eq(llmModelConfigs.id,next.id));available.sort((a,b)=>Number(b.id===next.id)-Number(a.id===next.id));}
      }
      const quick=available.find(c=>c.id===quickVersion?.id&&c.quickEnabled)??available.find(c=>c.quickEnabled);
      const deep=available.find(c=>c.id===deepVersion?.id&&c.deepEnabled)??available.find(c=>c.deepEnabled);
      if(!quick||!deep)return {error:'没有可用的 Quick / Deep 替代模型，任务已停止。',status:503} as const;
      replacement={quickModelConfigId:quick.id,deepModelConfigId:deep.id};
    }

    if(replacement) {
      const selection=replacement;
      let pinned;
      try { pinned=await pinModelVersions(tx,{id:selection.quickModelConfigId},{id:selection.deepModelConfigId}); }
      catch(error) { if(error instanceof ModelSelectionError)return {error:error.message,status:400} as const; throw error; }
      const quick=await readModelVersion(tx,pinned.quickModelVersionId),deep=await readModelVersion(tx,pinned.deepModelVersionId);
      await tx.insert(analysisJobResumptions).values({jobId,userId,
        previousQuickVersionId:existing.quickModelVersionId,previousDeepVersionId:existing.deepModelVersionId,
        nextQuickVersionId:pinned.quickModelVersionId,nextDeepVersionId:pinned.deepModelVersionId,
        configurationState:'versioned',initiator:autoOwner?'automatic':'user',
        previousQuickModel:quickVersion?.modelName ?? (historical.quickModel as string|null) ?? null,
        previousDeepModel:deepVersion?.modelName ?? (historical.deepModel as string|null) ?? null,
        nextQuickModel:quick.modelName,nextDeepModel:deep.modelName,
        previousQuickConfigSnapshot:quickVersion ? immutableModelSnapshot(quickVersion) : encryptedHistoricalSnapshot((historical.quickConfigSnapshot as string|null) ?? null),
        previousDeepConfigSnapshot:deepVersion ? immutableModelSnapshot(deepVersion) : encryptedHistoricalSnapshot((historical.deepConfigSnapshot as string|null) ?? null),
        nextQuickConfigSnapshot:immutableModelSnapshot(quick),nextDeepConfigSnapshot:immutableModelSnapshot(deep)});
      changed=pinned;
    }else if(!quickVersion || !deepVersion) {
      return {error:'旧任务缺少可靠模型版本，请选择模型后继续。',status:409} as const;
    }else if((await unavailableJobModels(existing,tx)).length) {
      return {error:'模型不可用，请使用“更换模型并继续”或联系管理员恢复模型。',status:409} as const;
    }
    const [job]=await tx.update(analysisJobs).set({...changed,status:'queued',workerOwner:null,workerLeaseUntil:null,externalStatus:'resume-queued',externalPid:null,errorMessage:null,completedAt:null,updatedAt:new Date()})
      .where(eq(analysisJobs.id,existing.id)).returning();
    return {job,status:200} as const;
  });
}
