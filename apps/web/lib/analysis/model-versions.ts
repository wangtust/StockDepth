import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { db } from '../db/drizzle';
import { llmModelConfigs, llmModelConfigVersions, type LlmModelConfig } from '../db/schema';
import { decryptModelKey, encryptModelKey } from '../security/model-key';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, 'select'>;
type Identity = typeof llmModelConfigs.$inferSelect;
type Version = typeof llmModelConfigVersions.$inferSelect;
export type ModelExecutionFields = Pick<LlmModelConfig,'provider'|'baseUrl'|'modelName'|'modelOptions'|'apiKey'|'inputPrice'|'cachePrice'|'outputPrice'>;
export class ModelSelectionError extends Error {}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function configFromVersion(identity: Identity, version: Version): LlmModelConfig {
  return {...identity, provider:version.provider,baseUrl:version.baseUrl,modelName:version.modelName,
    modelOptions:version.modelOptions,apiKey:version.encryptedApiKey??'',inputPrice:version.inputPrice,
    cachePrice:version.cachePrice,outputPrice:version.outputPrice,modelVersionId:version.id};
}
// Select identity and immutable execution version together so concurrent edits cannot mix versions.
export async function loadModelConfigs(reader: Reader, where?: SQL, options: {limit?:number} = {}) {
  const query=reader.select({identity:llmModelConfigs,version:llmModelConfigVersions}).from(llmModelConfigs)
    .innerJoin(llmModelConfigVersions,and(eq(llmModelConfigs.currentVersionId,llmModelConfigVersions.id),eq(llmModelConfigs.id,llmModelConfigVersions.configId)))
    .where(where).orderBy(desc(llmModelConfigs.isDefault),llmModelConfigs.id).$dynamic();
  const rows=await (options.limit ? query.limit(options.limit) : query);
  return rows.map(({identity,version})=>configFromVersion(identity,version));
}
export async function readCurrentModelConfig(reader:Reader,id:number) {
  return (await loadModelConfigs(reader,eq(llmModelConfigs.id,id),{limit:1}))[0] ?? null;
}
export async function ensureModelVersion(tx: Transaction, config: Pick<Identity,'id'>) {
  const [identity]=await tx.select().from(llmModelConfigs).where(eq(llmModelConfigs.id,config.id)).for('update');
  if (!identity?.currentVersionId) throw new ModelSelectionError('The model has no executable configuration version.');
  const [version]=await tx.select().from(llmModelConfigVersions).where(and(eq(llmModelConfigVersions.id,identity.currentVersionId),eq(llmModelConfigVersions.configId,identity.id)));
  if (!version || !version.encryptedApiKey || !decryptModelKey(version.encryptedApiKey)) throw new ModelSelectionError('Model credentials are not configured.');
  return version;
}
export async function saveModelVersion(tx:Transaction,configId:number,fields:ModelExecutionFields) {
  const [identity]=await tx.select().from(llmModelConfigs).where(eq(llmModelConfigs.id,configId)).for('update');
  if (!identity) throw new Error('Model configuration no longer exists');
  const plaintext=decryptModelKey(fields.apiKey);
  if(!plaintext)throw new ModelSelectionError('Model credentials are not configured.');
  const [current]=identity.currentVersionId?await tx.select().from(llmModelConfigVersions).where(and(eq(llmModelConfigVersions.id,identity.currentVersionId),eq(llmModelConfigVersions.configId,identity.id))):[];
  const {apiKey,...execution}=fields;
  const values={...execution,modelOptions:fields.modelOptions||{},priceCurrency:'CNY',priceUnitTokens:1000000};
  if(current?.encryptedApiKey && Object.entries(values).every(([key,value])=>canonical(current[key as keyof Version])===canonical(value)) && decryptModelKey(current.encryptedApiKey)===plaintext)return current;
  const [last]=await tx.select({version:llmModelConfigVersions.version}).from(llmModelConfigVersions).where(eq(llmModelConfigVersions.configId,configId)).orderBy(desc(llmModelConfigVersions.version)).limit(1);
  const [version]=await tx.insert(llmModelConfigVersions).values({...values,configId,version:(last?.version??0)+1,
    encryptedApiKey:apiKey.startsWith('sdkey:')?apiKey:encryptModelKey(plaintext),provenance:'configured'}).returning();
  await tx.update(llmModelConfigs).set({currentVersionId:version.id}).where(eq(llmModelConfigs.id,configId));
  return version;
}
export async function pinModelVersions(tx: Transaction, quickConfig: Pick<Identity,'id'>, deepConfig: Pick<Identity,'id'>) {
  const configs=new Map<number,Identity>();
  for(const id of [...new Set([quickConfig.id,deepConfig.id])].sort((a,b)=>a-b)) {
    const [config]=await tx.select().from(llmModelConfigs).where(and(eq(llmModelConfigs.id,id),eq(llmModelConfigs.isActive,true),isNull(llmModelConfigs.retiredAt),isNull(llmModelConfigs.unavailableReason))).for('update');
    if(!config)throw new ModelSelectionError('The selected model is unavailable. Select another model.');
    configs.set(id,config);
  }
  const quick=configs.get(quickConfig.id)!,deep=configs.get(deepConfig.id)!;
  if(!quick.quickEnabled||!deep.deepEnabled)throw new ModelSelectionError('The selected model does not support the requested Quick / Deep role.');
  const quickVersion=await ensureModelVersion(tx,quick),deepVersion=await ensureModelVersion(tx,deep);
  return {quickModelVersionId:quickVersion.id,deepModelVersionId:deepVersion.id,configurationState:'versioned' as const};
}
export async function readModelVersion(reader:Reader,versionId:number) {
  const [version]=await reader.select().from(llmModelConfigVersions).where(eq(llmModelConfigVersions.id,versionId));
  if(!version||!version.encryptedApiKey?.startsWith('sdkey:')||!decryptModelKey(version.encryptedApiKey))throw new Error('Pinned model version unavailable');
  return {...version,id:version.configId,apiKey:version.encryptedApiKey??'',modelVersionId:version.id,updatedAt:version.createdAt};
}
