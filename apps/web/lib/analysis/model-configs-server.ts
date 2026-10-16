import 'server-only';
import { readModelConfig, maskedModelKey } from '@/lib/security/model-key';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { llmModelConfigs } from '@/lib/db/schema';
import { loadModelConfigs } from './model-versions';
const available=()=>and(eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason));
export async function getActiveModelConfigs() {
  const configs=await loadModelConfigs(db,available());
  return configs.map(({id,name,provider,modelName,modelOptions,quickEnabled,deepEnabled,isDefault,isActive,updatedAt})=>
    ({id,name,provider,modelName,modelOptions,quickEnabled,deepEnabled,isDefault,isActive,updatedAt}));
}
export async function getModelConfigsForAdmin() {
  const configs=await loadModelConfigs(db,isNull(llmModelConfigs.retiredAt));
  return configs.map(config=>({...config,apiKey:maskedModelKey(config.apiKey)}));
}
export async function getDefaultModelConfig() {
  const configs=await loadModelConfigs(db,available(),{limit:1});
  return configs[0]?readModelConfig(configs[0]):null;
}
export function maskApiKey(apiKey:string) { return maskedModelKey(apiKey); }
