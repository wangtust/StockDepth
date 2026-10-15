// Coordinator-required patch candidate only; protected actions.ts is never changed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),ts=require(root+'/apps/workers/node_modules/typescript');
function compile(source,mocks){const out=ts.transpileModule(source,{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function('require','module','exports',out)(name=>name in mocks?mocks[name]:require(name),m,m.exports);return m.exports;}
const keys=compile(fs.readFileSync(root+'/apps/web/lib/security/model-key.ts','utf8'),{});
const schema={adminAuditLogs:{},llmModelConfigs:{},users:{},analysisJobs:{},analysisPricing:{},creditTransactions:{}};
let writes=[],audits=[],probes=0;
const db = {
 transaction: async fn => fn(db),
 insert(table) {
  return { values(data) {
   if (table === schema.llmModelConfigs) {
    writes.push(data); return { returning: async () => [{...data, id: 1}] };
   }
   audits.push(data); return Promise.resolve();
  }};
 },
 update() {
  return { set(data) {
   writes.push(data);
   return { where() {
    return { returning: async () => [{...data,id:1}], then(resolve) { return Promise.resolve().then(resolve); } };
   }};
  }};
 }
};
const actions=compile(fs.readFileSync(process.env.ROUND5_ADMIN_ACTIONS_SOURCE || root+'/apps/web/app/admin/actions.ts','utf8'),{
 '@/lib/credits/admin-adjustment':{adjustCreditBalance:async()=>assert.fail('Credit adjustment is outside this test')},'@/lib/analysis/runner-process':{isAnalysisRunner:()=>false},'@/lib/security/model-key':keys,'@/lib/analysis/test-model-server':{testModelConnection:async()=>{probes++;return {success:true}}},'next/cache':{revalidatePath(){}},'drizzle-orm':{and(){},eq(){},isNull(){},sql(){}},'zod':require(root+'/apps/web/node_modules/zod'),
 '@/lib/auth/admin':{requirePlatformAdmin:async()=>({id:1}),writeAdminAuditLog:async data=>audits.push(data)},'@/lib/analysis/concurrency-settings':{},'@/lib/db/drizzle':{db},'@/lib/db/schema':schema,'@/lib/analysis/pricing':{}
});
function form(withKey=true){const f=new FormData();Object.entries({configId:'1',name:'fixture',provider:'openai',baseUrl:'http://mock.invalid',modelName:'mock',isActive:'on',...(withKey?{apiKey:'synthetic-admin-secret'}:{})}).forEach(([k,v])=>f.set(k,v));return f;}
(async()=>{
 delete process.env.STOCKDEPTH_MODEL_KEY_ID;delete process.env.STOCKDEPTH_MODEL_KEYRING;
 assert((await actions.createModelConfig(form())).error);assert.equal(probes,0);assert.equal(writes.length,0);
 assert((await actions.updateModelConfig(form())).error);assert.equal(writes.length,0);
 Object.assign(process.env,{STOCKDEPTH_MODEL_KEY_ID:'fixture',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({fixture:crypto.randomBytes(32).toString('base64url')})});
 assert((await actions.createModelConfig(form())).success);assert.equal(probes,1);assert.equal(keys.decryptModelKey(writes[0].apiKey),'synthetic-admin-secret');
 assert((await actions.updateModelConfig(form())).success);assert.equal(keys.decryptModelKey(writes.at(-1).apiKey),'synthetic-admin-secret');
 assert((await actions.updateModelConfig(form(false))).success);assert(!('apiKey' in writes.at(-1)));
 assert(!JSON.stringify(writes).includes('synthetic-admin-secret'));assert(!JSON.stringify(audits).includes('synthetic-admin-secret'));assert(!JSON.stringify(audits).includes('sdkey:'));
 console.log('PASS reviewed actions patch: missing key before probe/write, create/update ciphertext only, omitted key preserved, no audit secret; protected source untouched');
})().catch(error=>{console.error('admin_patch_test_failed',error.name);console.error(String(error.stack).split('\n').filter(l=>l.trim().startsWith('at ')).join('\n'));process.exitCode=1});
