// Execute real reader/probe source against mocks. Never start workers or contact a provider.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'../..');
const ts=require(root+'/apps/workers/node_modules/typescript');
function compile(source,mocks){const out=ts.transpileModule(source,{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('require','module','exports',out)(name=>name in mocks?mocks[name]:require(name),module,module.exports);return module.exports;}
const keys=compile(fs.readFileSync(root+'/apps/web/lib/security/model-key.ts','utf8'),{});
Object.assign(process.env,{STOCKDEPTH_MODEL_KEY_ID:'fixture',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({fixture:crypto.randomBytes(32).toString('base64url')})});
const plaintext='synthetic-reader-secret';
let rows=[{id:1,apiKey:keys.encryptModelKey(plaintext),isActive:true,retiredAt:null,modelName:'mock'}];
const query={from(){return this},where(){return this},orderBy(){return this},limit(){return Promise.resolve(rows)},then(resolve){return Promise.resolve(rows).then(resolve)}};
const db={select(){return query},update(){return {set(){return {where:async()=>{}}}}}};
const operators={and(){},asc(){},desc(){},eq(){},isNull(){},sql(){}};
const schema={llmModelConfigs:{},analysisJobs:{}};
const getters=compile(fs.readFileSync(root+'/apps/web/lib/analysis/model-configs-server.ts','utf8'),{'server-only':{},'drizzle-orm':operators,'@/lib/db/drizzle':{db},'@/lib/db/schema':schema,'@/lib/security/model-key':keys});
function workerFragment(file,start,end,name,extra=''){
 const source=fs.readFileSync(root+'/'+file,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert(declaration,'Actual reader function must exist');const snippet=declaration.getText(ast);
 return compile(`const {db, llmModelConfigs, analysisJobs, readModelConfig, decryptModelKey, and, asc, eq, isNull, sql, fetchWithBackoff, tradingAgentsUrl, authHeader, runIdFor, parseAnalysts,ownedAnalysis,resourceMonitor}=require('fixture'); ${snippet}; ${extra}; exports.reader=${name};`,{fixture:{db,...schema,...keys,...operators,tradingAgentsUrl:'http://mock.invalid',authHeader:()=>({}),runIdFor:()=> 'safe-fixture-id',parseAnalysts:()=>[],ownedAnalysis:()=>({}),resourceMonitor:{track:async()=>{}},fetchWithBackoff:async(url,options)=>{const payload=JSON.parse(options.body);assert.equal(payload.models.quick.api_key,plaintext);assert.equal(payload.models.deep.api_key,plaintext);calls++;return {ok:true,json:async()=>({status:'started'})}}}}).reader;
}
let calls=0;
const paper=workerFragment('apps/workers/src/paper-trader-worker.ts','async function getDefaultModelConfig()', 'async function claimNextRun','getDefaultModelConfig');
const analysis=workerFragment('apps/workers/src/analysis-worker.ts','async function startStockDepth(', 'async function fetchRun','startStockDepth');
let probeCalls=0;
const probe=compile(fs.readFileSync(root+'/apps/web/lib/analysis/test-model-server.ts','utf8'),{'server-only':{},'@/lib/security/model-key':keys,'node:child_process':{spawn(bin,args,options){probeCalls++;assert.equal(options.env.STOCKDEPTH_MODEL_KEYRING,undefined);const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};child.stdin.end=data=>{assert.equal(JSON.parse(data).apiKey,plaintext);queueMicrotask(()=>{child.stdout.emit('data',Buffer.from('STOCKDEPTH_PROBE_RESULT={"success":true}\n'));child.emit('close',0)})};return child}}});
(async()=>{
 for(const value of [keys.encryptModelKey(plaintext),plaintext]){
  rows[0].apiKey=value;
  assert.equal((await getters.getDefaultModelConfig()).apiKey,plaintext);
  assert.equal((await paper()).apiKey,plaintext);
  assert.equal((await getters.getModelConfigsForAdmin())[0].apiKey,'configured');
  assert(!JSON.stringify(await getters.getModelConfigsForAdmin()).includes(plaintext));
  await analysis({id:1,quickConfigSnapshot:JSON.stringify(rows[0]),deepConfigSnapshot:JSON.stringify(rows[0])});
  assert.deepEqual(await probe.testModelConnection({provider:'mock',modelName:'mock',baseUrl:'mock',apiKey:value}),{success:true});
 }
 rows[0].apiKey='sdkey:v2:invalid';
 await assert.rejects(getters.getDefaultModelConfig());await assert.rejects(paper());await assert.rejects(analysis({id:1,quickConfigSnapshot:JSON.stringify(rows[0]),deepConfigSnapshot:JSON.stringify(rows[0])}));
 assert.equal(calls,2);
 assert((await probe.testModelConnection({apiKey:rows[0].apiKey})).error);assert.equal(probeCalls,2);
 rows=[];assert.equal(await getters.getDefaultModelConfig(),null);assert.equal(await paper(),null);
 console.log('PASS real source web/admin/analysis/paper/probe readers; legacy+envelope, fail-before-request, opaque admin output, child keyring omitted; zero network');
})().catch(error=>{console.error('security_reader_test_failed',error.name);console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).join('\n'));process.exitCode=1});
