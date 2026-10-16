import { llmModelConfigs, type LlmModelConfig } from '../../apps/web/lib/db/schema';
import { configFromVersion, readCurrentModelConfig, saveModelVersion } from '../../apps/web/lib/analysis/model-versions';
import type { db } from '../../apps/web/lib/db/drizzle';
import { eq } from '../../apps/web/node_modules/drizzle-orm';
type Transaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader=typeof db|Transaction;
type Fields=Partial<Omit<LlmModelConfig,'createdAt'|'updatedAt'|'currentVersionId'|'modelVersionId'>> & {name:string};
// Use the same version-only write path as administrators in integration fixtures.
export async function createModelFixture(reader:Reader,fields:Fields) {
  const execute=async(tx:Transaction)=>{
    const {provider='mock',baseUrl='http://127.0.0.1:1',apiKey='synthetic-fixture-key',modelName=fields.name,modelOptions={},inputPrice=null,cachePrice=null,outputPrice=null,...identity}=fields;
    const [row]=await tx.insert(llmModelConfigs).values(identity).returning();
    const version=await saveModelVersion(tx,row.id,{provider,baseUrl,apiKey,modelName,modelOptions,inputPrice,cachePrice,outputPrice});
    return configFromVersion({...row,currentVersionId:version.id},version);
  };
  return reader.transaction(execute);
}
export async function updateModelFixture(reader:Reader,id:number,fields:Partial<LlmModelConfig>) {
  return reader.transaction(async tx=>{
    const current=await readCurrentModelConfig(tx,id);
    if(!current)throw new Error('Model fixture not found');
    const {provider,baseUrl,apiKey,modelName,modelOptions,inputPrice,cachePrice,outputPrice,...identity}={...current,...fields};
    const {id:ignored,createdAt,currentVersionId,modelVersionId,...updates}=identity;
    const [row]=await tx.update(llmModelConfigs).set(updates).where(eq(llmModelConfigs.id,id)).returning();
    const version=await saveModelVersion(tx,id,{provider,baseUrl,apiKey,modelName,modelOptions,inputPrice,cachePrice,outputPrice});
    return configFromVersion({...row,currentVersionId:version.id},version);
  });
}
