import {and,eq,isNull,desc,asc,sql} from 'drizzle-orm';
import {db} from '../db/drizzle';
import {analysisJobs,analysisJobResumptions,llmModelConfigs} from '../db/schema';
import {immutableModelSnapshot,encryptedHistoricalSnapshot} from './model-snapshot';
import {unavailableJobModels} from './model-availability';
export type ReplacementModels={quickModelConfigId:number;deepModelConfigId:number};
export async function resumeAnalysisJob(userId:number,jobId:number,replacement?:ReplacementModels, autoOwner?:string) {
  return db.transaction(async tx=>{
    const [existing]=await tx.select().from(analysisJobs).where(and(eq(analysisJobs.id,jobId),eq(analysisJobs.userId,userId),isNull(analysisJobs.hiddenAt))).for('update');
    if(!existing||(autoOwner ? existing.status!=='running'||existing.workerOwner!==autoOwner||!existing.workerLeaseUntil||existing.workerLeaseUntil<=new Date() : existing.status!=='failed'))return {error:'Only failed analysis jobs can be continued',status:409} as const;
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
      const quick=available.find(c=>c.id===existing.quickModelConfigId&&c.quickEnabled)??available.find(c=>c.quickEnabled);
      const deep=available.find(c=>c.id===existing.deepModelConfigId&&c.deepEnabled)??available.find(c=>c.deepEnabled);
      if(!quick||!deep)return {error:'没有可用的 Quick / Deep 替代模型，任务已停止。',status:503} as const;
      replacement={quickModelConfigId:quick.id,deepModelConfigId:deep.id};
    }

    if(replacement) {
      const selection=replacement;
      // Lock in stable ID order so opposite Quick/Deep selections cannot deadlock.
      const ids=[...new Set([selection.quickModelConfigId,selection.deepModelConfigId])].sort((a,b)=>a-b);
      const configs:typeof llmModelConfigs.$inferSelect[]=[];
      for(const id of ids) {
        const [config]=await tx.select().from(llmModelConfigs).where(and(eq(llmModelConfigs.id,id),eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason))).for('share');
        if(!config)return {error:'所选模型不可用，请重新选择。',status:400} as const;
        configs.push(config);
      }
      const quick=configs.find(c=>c.id===selection.quickModelConfigId)!,deep=configs.find(c=>c.id===selection.deepModelConfigId)!;
      if(!quick.quickEnabled||!deep.deepEnabled)return {error:'所选模型不支持对应的 Quick / Deep 角色。',status:400} as const;
      const quickConfigSnapshot=immutableModelSnapshot(quick),deepConfigSnapshot=immutableModelSnapshot(deep);
      await tx.insert(analysisJobResumptions).values({jobId,userId,previousQuickModel:existing.quickModel,previousDeepModel:existing.deepModel,nextQuickModel:quick.modelName,nextDeepModel:deep.modelName,
        previousQuickConfigSnapshot:encryptedHistoricalSnapshot(existing.quickConfigSnapshot),previousDeepConfigSnapshot:encryptedHistoricalSnapshot(existing.deepConfigSnapshot),nextQuickConfigSnapshot:quickConfigSnapshot,nextDeepConfigSnapshot:deepConfigSnapshot});
      changed={provider:quick.provider,baseUrl:quick.baseUrl,quickModel:quick.modelName,deepModel:deep.modelName,modelConfigId:quick.id,quickModelConfigId:quick.id,deepModelConfigId:deep.id,quickConfigSnapshot,deepConfigSnapshot};
    }else if((await unavailableJobModels(existing,tx)).length) {
      return {error:'模型额度不足，请使用“更换模型并继续”或联系管理员恢复模型。',status:409} as const;
    }
    const [job]=await tx.update(analysisJobs).set({...changed,status:'queued',workerOwner:null,workerLeaseUntil:null,externalStatus:'resume-queued',externalPid:null,errorMessage:null,completedAt:null,updatedAt:new Date()})
      .where(eq(analysisJobs.id,existing.id)).returning();
    return {job,status:200} as const;
  });
}
