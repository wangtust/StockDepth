// Actual enqueue route + isolated SQL; auth/catalogue are explicit fixtures.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const {randomUUID, randomBytes} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..'), modules = root + '/apps/web/node_modules';
require(modules + '/dotenv').config({path: root + '/.env'});
const source = new URL(process.env.POSTGRES_URL);
if (!['127.0.0.1','localhost','::1','[::1]'].includes(source.hostname)) throw Error('Local isolated DB required');
const postgres = require(modules + '/postgres');
const {drizzle} = require(modules + '/drizzle-orm/postgres-js');
const {migrate} = require(modules + '/drizzle-orm/postgres-js/migrator');
const esbuild = require(require.resolve('esbuild', {paths:[require.resolve(root + '/apps/workers/node_modules/tsx/package.json')]}));
const name = 'stockdepth_stage2_coordinator_' + randomUUID().replaceAll('-', '');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-stage2-dependencies-'));
const admin = postgres(source.toString(), {max:1});
let created = false, test;
async function main() {
 try {
  await admin`create database ${admin(name)}`; created = true;
  source.pathname = '/' + name;
  test = postgres(source.toString(), {max:1});
  await migrate(drizzle(test), {migrationsFolder: root + '/apps/web/lib/db/migrations'});
  const entry = `
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {eq, sql} from 'drizzle-orm';
import * as s from '@/lib/db/schema';
import {POST} from './app/api/analysis/jobs/route';
import {decryptModelKey} from '@/lib/security/model-key';
async function main() {
 const client = postgres(process.env.POSTGRES_URL!, {max:1});
 const db = drizzle(client, {schema:s}); (globalThis as any).fixtureDb = db;
 try {
  const [database] = await client\`select current_database() as name\`;
  assert(database.name.startsWith('stockdepth_stage2_coordinator_'));
  const [user] = await db.insert(s.users).values({email:'coordinator@test.invalid',passwordHash:'unused'}).returning();
await db.update(s.billingAccounts).set({analysisCredits:100,ledgerOpeningBalance:100}).where(eq(s.billingAccounts.userId,user.id));
  const [instrument] = await db.insert(s.instruments).values({symbol:'MOCK',exchange:'UNRESOLVED'}).returning();
  (globalThis as any).fixtureInstrument = instrument;
  await db.insert(s.analysisPricing).values({depth:1,label:'Mock',creditCost:10}).onConflictDoUpdate({target:s.analysisPricing.depth,set:{creditCost:10}});
  const [quick] = await db.insert(s.llmModelConfigs).values({name:'Quick',provider:'qwen',modelName:'quick-mock',baseUrl:'http://127.0.0.1:1',apiKey:'fixture-quick',quickEnabled:true,deepEnabled:false,modelOptions:{request_concurrency:1},inputPrice:'1.123456',cachePrice:'0.123456',outputPrice:'2.123456'}).returning();
  const [deep] = await db.insert(s.llmModelConfigs).values({name:'Deep',provider:'anthropic',modelName:'deep-mock',baseUrl:'http://127.0.0.1:1',apiKey:'fixture-deep',quickEnabled:false,deepEnabled:true}).returning();
  const request = (body:any) => POST({json:async()=>body} as any);
  const body = {ticker:'mock',depth:1,quickModelConfigId:quick.id,deepModelConfigId:deep.id};
  assert.equal((await request(body)).status,401);
  (globalThis as any).fixtureUser=user;
  assert.equal((await request({...body,quickModelConfigId:deep.id})).status,400);
  assert.equal((await request({ticker:'MOCK',depth:1})).status,400);
  const response = await request(body); assert.equal(response.status,201);
  const publicJob = (await response.json()).job;
  assert.equal(publicJob.remainingCredits,90);
  for (const field of ['quickConfigSnapshot','deepConfigSnapshot','workerOwner','workerLeaseUntil']) assert(!(field in publicJob));
  const [job] = await db.select().from(s.analysisJobs).where(eq(s.analysisJobs.id,publicJob.id));
  const q=JSON.parse(job.quickConfigSnapshot!), d=JSON.parse(job.deepConfigSnapshot!);
  assert(q.apiKey.startsWith('sdkey:') && d.apiKey.startsWith('sdkey:'));
  assert.equal(decryptModelKey(q.apiKey),'fixture-quick'); assert.equal(decryptModelKey(d.apiKey),'fixture-deep');
  assert.equal(q.provider,'qwen'); assert.equal(d.provider,'anthropic'); assert.equal(q.inputPrice,'1.123456');
  assert.equal(q.modelOptions.request_concurrency,1);
  await db.update(s.llmModelConfigs).set({inputPrice:'999',modelName:'changed'}).where(eq(s.llmModelConfigs.id,quick.id));
  assert.equal(JSON.parse((await db.select().from(s.analysisJobs))[0].quickConfigSnapshot!).inputPrice,'1.123456');
  const ledger = await db.select().from(s.creditTransactions); assert.equal(ledger.length,1); assert.equal(ledger[0].amount,-10);
  await db.update(s.billingAccounts).set({analysisCredits:0}).where(eq(s.billingAccounts.userId,user.id));
  assert.equal((await request(body)).status,402);
  assert.equal((await db.select().from(s.creditTransactions)).length,1);
  assert.equal((await db.select().from(s.analysisJobs)).length,1);
  await db.update(s.llmModelConfigs).set({quickEnabled:true,deepEnabled:true}).where(eq(s.llmModelConfigs.id,deep.id));
  await db.update(s.billingAccounts).set({analysisCredits:20}).where(eq(s.billingAccounts.userId,user.id));
  assert.equal((await request({ticker:'MOCK',depth:1,modelConfigId:deep.id})).status,201);
  delete process.env.STOCKDEPTH_MODEL_KEYRING;
  assert.equal((await request(body)).status,503);
  assert.equal((await db.select().from(s.creditTransactions)).length,2);
  console.log('Actual enqueue route: auth, role validation, encrypted cross-vendor snapshots, immutable prices/options, public DTO, atomic credits/ledger, insufficient credits, legacy selection, missing keyring passed; no Worker/model/trade');
 } finally {await client.end();}
}
main().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});
`;
  const mocks = {
   '@/lib/db/queries': 'export const getUser=async()=>globalThis.fixtureUser || null;',
   '@/lib/db/drizzle': 'export const db=new Proxy({}, {get:(_,key)=>{const value=globalThis.fixtureDb[key];return typeof value === "function" ? value.bind(globalThis.fixtureDb) : value;}});',
   '@/lib/market/catalogue': 'export const ensureInstrument=async()=>globalThis.fixtureInstrument;',
   '@/lib/analysis/jobs-page': 'export const getJobsPage=async()=>{throw Error("GET outside scope");};',
   'server-only': ''
  };
  const outfile = directory + '/test.cjs';
  await esbuild.build({stdin:{contents:entry,resolveDir:root+'/apps/web',sourcefile:'coordinator-stage2-fixture.ts',loader:'ts'},
   outfile,bundle:true,platform:'node',format:'cjs',packages:'external',tsconfig:root+'/apps/web/tsconfig.json',
   plugins:[{name:'explicit-fixtures',setup(build){
    build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
   }}]});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|PASSWORD|DATABASE|POSTGRES|MODEL_CONFIG)/i.test(key)));
  Object.assign(env,{POSTGRES_URL:source.toString(),STOCKDEPTH_MODEL_KEY_ID:'fixture',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({fixture:randomBytes(32).toString('base64url')}),NODE_PATH:modules});
  const child = spawnSync(process.execPath,[outfile],{env,stdio:'inherit',timeout:30000});
  if (child.status !== 0) throw Error('Enqueue dependency acceptance failed');
 } finally {
  if(test) await test.end();
  if(created) await admin`drop database ${admin(name)} with (force)`;
  await admin.end(); fs.rmSync(directory,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});
