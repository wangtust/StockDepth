import {and,eq,isNull} from 'drizzle-orm';
import {db} from '../db/drizzle';
import {analysisJobs,analysisJobResumptions,llmModelConfigs} from '../db/schema';
import {immutableModelSnapshot,encryptedHistoricalSnapshot} from './model-snapshot';
import {unavailableJobModels} from './model-availability';
export type ReplacementModels={quickModelConfigId:number;deepModelConfigId:number};
export async function resumeAnalysisJob(userId:number,jobId:number,replacement?:ReplacementModels) {
  return db.transaction(async tx=>{
    const [existing]=await tx.select().from(analysisJobs).where(and(eq(analysisJobs.id,jobId),eq(analysisJobs.userId,userId),isNull(analysisJobs.hiddenAt))).for('update');
    if(!existing||existing.status!=='failed')return {error:'Only failed analysis jobs can be continued',status:409} as const;
    let changed:Partial<typeof analysisJobs.$inferInsert>={};
    if(replacement) {
      // Lock in stable ID order so opposite Quick/Deep selections cannot deadlock.
      const ids=[...new Set([replacement.quickModelConfigId,replacement.deepModelConfigId])].sort((a,b)=>a-b);
      const configs:typeof llmModelConfigs.$inferSelect[]=[];
      for(const id of ids) {
        const [config]=await tx.select().from(llmModelConfigs).where(and(eq(llmModelConfigs.id,id),eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason))).for('share');
        if(!config)return {error:'所选模型不可用，请重新选择。',status:400} as const;
        configs.push(config);
      }
      const quick=configs.find(c=>c.id===replacement.quickModelConfigId)!,deep=configs.find(c=>c.id===replacement.deepModelConfigId)!;
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
