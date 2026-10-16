import { and, desc, eq, isNull } from 'drizzle-orm';
import type { db } from '../db/drizzle';
import { llmModelConfigs, llmModelConfigVersions } from '../db/schema';
import { decryptModelKey, encryptModelKey } from '../security/model-key';
import { immutableModelSnapshot } from './model-snapshot';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class ModelSelectionError extends Error {}
type Config = typeof llmModelConfigs.$inferSelect;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

// Always re-read under the identity lock; callers may have selected before their transaction.
export async function ensureModelVersion(tx: Transaction, config: Pick<Config,'id'>) {
  const [locked] = await tx.select().from(llmModelConfigs).where(eq(llmModelConfigs.id, config.id)).for('update');
  if (!locked) throw new Error('Model configuration no longer exists');
  const plaintext = decryptModelKey(locked.apiKey);
  const encryptedApiKey = locked.apiKey.startsWith('sdkey:') ? locked.apiKey : encryptModelKey(plaintext);
  const fields = { provider: locked.provider, baseUrl: locked.baseUrl, modelName: locked.modelName,
    modelOptions: locked.modelOptions || {}, inputPrice: locked.inputPrice, cachePrice: locked.cachePrice,
    outputPrice: locked.outputPrice, priceCurrency: 'CNY', priceUnitTokens: 1000000 };
  const [current] = locked.currentVersionId ? await tx.select().from(llmModelConfigVersions)
    .where(and(eq(llmModelConfigVersions.id, locked.currentVersionId),eq(llmModelConfigVersions.configId,locked.id))) : [];
  if (current?.encryptedApiKey.startsWith('sdkey:') && Object.entries(fields).every(([key,value])=>canonical(current[key as keyof typeof current])===canonical(value))
    && decryptModelKey(current.encryptedApiKey) === plaintext) return current;
  const [last] = await tx.select({version:llmModelConfigVersions.version}).from(llmModelConfigVersions)
    .where(eq(llmModelConfigVersions.configId,locked.id)).orderBy(desc(llmModelConfigVersions.version)).limit(1);
  const [version] = await tx.insert(llmModelConfigVersions).values({configId:locked.id,version:(last?.version ?? 0)+1,
    ...fields,encryptedApiKey,provenance:'configured'}).returning();
  await tx.update(llmModelConfigs).set({currentVersionId:version.id}).where(eq(llmModelConfigs.id,locked.id));
  return version;
}

export async function pinModelVersions(tx: Transaction, quickConfig: Pick<Config,'id'>, deepConfig: Pick<Config,'id'>) {
  const configs = new Map<number,Config>();
  for (const id of [...new Set([quickConfig.id,deepConfig.id])].sort((a,b)=>a-b)) {
    const [config] = await tx.select().from(llmModelConfigs).where(and(eq(llmModelConfigs.id,id),
      eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason))).for('update');
    if (!config) throw new ModelSelectionError('所选模型不可用，请重新选择。');
    configs.set(id,config);
  }
  const quick=configs.get(quickConfig.id)!, deep=configs.get(deepConfig.id)!;
  if (!quick.quickEnabled || !deep.deepEnabled) throw new ModelSelectionError('所选模型不支持对应的 Quick / Deep 角色。');
  const quickVersion=await ensureModelVersion(tx,quick), deepVersion=await ensureModelVersion(tx,deep);
  return {quickModelVersionId:quickVersion.id,deepModelVersionId:deepVersion.id,configurationState:'versioned' as const,
    // Display caches and legacy dualwrites must come from the locked rows too;
    // an administrator may have edited the earlier pre-transaction selection.
    modelConfigId:quick.id,quickModelConfigId:quick.id,deepModelConfigId:deep.id,
    provider:quick.provider,baseUrl:quick.baseUrl,quickModel:quick.modelName,deepModel:deep.modelName,
    quickConfigSnapshot:immutableModelSnapshot(quick),deepConfigSnapshot:immutableModelSnapshot(deep)};
}

export async function readModelVersion(reader: Pick<Transaction,'select'>, versionId: number) {
  const [version] = await reader.select().from(llmModelConfigVersions).where(eq(llmModelConfigVersions.id,versionId));
  if (!version || !version.encryptedApiKey.startsWith('sdkey:')) throw new Error('Pinned model version unavailable');
  decryptModelKey(version.encryptedApiKey); // Validate the envelope before returning execution data.
  // Config-shaped execution adapter. Identity/availability is deliberately separate.
  return { ...version, id:version.configId, apiKey:version.encryptedApiKey, modelVersionId:version.id, updatedAt:version.createdAt };
}
