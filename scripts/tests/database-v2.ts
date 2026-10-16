// Real PostgreSQL V2 integration checks. All writes target databases created here.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
const root=process.cwd(),require=createRequire(import.meta.url);
const {drizzle}=require(root+'/apps/web/node_modules/drizzle-orm/postgres-js');
const {migrate}=require(root+'/apps/web/node_modules/drizzle-orm/postgres-js/migrator');
async function main(){
 const source=process.env.POSTGRES_URL!;assert(source,'POSTGRES_URL required');
 const admin=postgres(source,{max:1,onnotice:()=>{}}),created:string[]=[],connections:ReturnType<typeof postgres>[]=[];
 const temporary=await mkdtemp(path.join(tmpdir(),'stockdepth-v2-'));let appClient:ReturnType<typeof postgres>|undefined;
 async function database(kind:string){const name=`stockdepth_v2_${kind}_${randomUUID().replaceAll('-','')}`;await admin.unsafe(`create database "${name}"`);created.push(name);const url=new URL(source);url.pathname='/'+name;const sql=postgres(url.toString(),{max:5,onnotice:()=>{}});connections.push(sql);return {sql,url};}
 const folder=root+'/apps/web/lib/db/migrations';
 try{
  const old=path.join(temporary,'baseline');await mkdir(path.join(old,'meta'),{recursive:true});
  const journal=JSON.parse(await readFile(path.join(folder,'meta/_journal.json'),'utf8'));
  const baseline=journal.entries.findIndex((e:{tag:string})=>e.tag==='0039_neat_dagger');assert(baseline>=0);
  journal.entries=journal.entries.slice(0,baseline+1);await writeFile(path.join(old,'meta/_journal.json'),JSON.stringify(journal));
  for(const entry of journal.entries)await copyFile(path.join(folder,entry.tag+'.sql'),path.join(old,entry.tag+'.sql'));
  const upgrade=await database('upgrade');await migrate(drizzle(upgrade.sql),{migrationsFolder:old});
  const [legacy]=await upgrade.sql`insert into users(email,password_hash,analysis_credits) values('legacy-v2@example.test','fixture',37) returning id`;
  await upgrade.sql`insert into credit_transactions(user_id,amount,reason) values(${legacy.id},7,'legacy-evidence')`;
  const [job]=await upgrade.sql`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts) values(${legacy.id},${randomUUID()},'MOCK','2026-10-15','[]') returning id`;
  await upgrade.sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${legacy.id},'market','legacy','PRESERVE')`;
  for(let i=0;i<2;i++)await migrate(drizzle(upgrade.sql),{migrationsFolder:folder});
  const [account]=await upgrade.sql`select * from billing_accounts where user_id=${legacy.id}`;
  assert(account,'migration creates historical billing account');assert.equal(account.analysis_credits,37);assert.equal(account.ledger_opening_balance,37);assert.equal(Number(account.ledger_sequence),0);
  const rows=await upgrade.sql`select * from credit_transactions where user_id=${legacy.id}`;
  assert.equal(rows.length,1,'no fabricated historical grants');assert.equal(rows[0].ledger_sequence,null);assert.equal(rows[0].balance_after,null);assert.equal(rows[0].reason,'legacy-evidence');
  const [unknown]=await upgrade.sql`select * from analysis_jobs where id=${job.id}`;
  assert.equal(unknown.quick_model_version_id,null);assert.equal(unknown.deep_model_version_id,null);assert.equal(unknown.charged_credits,null,'unknown old charge remains unknown');
  assert.equal((await upgrade.sql`select content from analysis_reports where job_id=${job.id}`)[0].content,'PRESERVE');
  const fresh=await database('fresh');
  for(let i=0;i<2;i++){const result=spawnSync(process.execPath,[root+'/scripts/initialize-database.cjs'],{cwd:root,env:{...process.env,POSTGRES_URL:fresh.url.toString(),STOCKDEPTH_ADMIN_EMAIL:'',STOCKDEPTH_ADMIN_PASSWORD:''},encoding:'utf8'});assert.equal(result.status,0,'initializer succeeds on fresh DB and repeat');}
  assert.equal(Number((await fresh.sql`select count(*) from pg_tables where schemaname='public'`)[0].count),30);
  assert.equal(Number((await fresh.sql`select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and not c.convalidated`)[0].count),0);
  for(const name of ['analysis_jobs_user_visible_id_idx','analysis_jobs_status_created_at_idx','analysis_jobs_worker_lease_idx'])assert.equal((await fresh.sql`select indexname from pg_indexes where schemaname='public' and indexname=${name}`).length,1,'existing access index '+name);
  process.env.POSTGRES_URL=fresh.url.toString();process.env.STOCKDEPTH_MODEL_KEY_ID='fixture';process.env.STOCKDEPTH_MODEL_KEYRING=JSON.stringify({fixture:randomBytes(32).toString('base64url')});
  const databaseModule=await import('../../apps/web/lib/db/drizzle');appClient=databaseModule.client;
  await exerciseApplication(databaseModule.db,fresh.sql);
  console.log('PASS database-v2: fresh/repeated initialization, pre-V2 preservation, honest opening balance/unknown jobs, validated constraints, existing indexes, application ledger and immutable model versions. Disposable databases only; no providers/email.');
 }finally{if(appClient)await appClient.end();for(const sql of connections)await sql.end();for(const name of created)await admin.unsafe(`drop database if exists "${name}" with (force)`);await admin.end();await rm(temporary,{recursive:true,force:true});}
}
async function exerciseApplication(db:any,sql:ReturnType<typeof postgres>){
 const {users,llmModelConfigs,adminAuditLogs}=await import('../../apps/web/lib/db/schema');
 const {recordInitialCreditGrant}=await import('../../apps/web/lib/credits/initial-grant');
 const {mutateCredits}=await import('../../apps/web/lib/credits/ledger');
 const {pinModelVersions,readModelVersion}=await import('../../apps/web/lib/analysis/model-versions');
 const {eq}=await import('../../apps/web/node_modules/drizzle-orm');
 const addUser=async(email:string,reason:'signup_grant'|'seed_initial_grant')=>db.transaction(async(tx:any)=>{const [user]=await tx.insert(users).values({email,passwordHash:'fixture'}).returning();await recordInitialCreditGrant(tx,user,reason);return user;});
 const {initializeAdmin}=require(root+'/scripts/initialize-admin.cjs');
 await initializeAdmin(sql,{STOCKDEPTH_ADMIN_EMAIL:'v2-admin@example.test',STOCKDEPTH_ADMIN_PASSWORD:'SyntheticFixture123!'});
 await initializeAdmin(sql,{STOCKDEPTH_ADMIN_EMAIL:'v2-admin@example.test',STOCKDEPTH_ADMIN_PASSWORD:'SyntheticFixture123!'});
 const [administrator]=await sql`select id from users where role='super_admin'`;
 const signup=await addUser('v2-signup@example.test','signup_grant'),seed=await addUser('v2-seed@example.test','seed_initial_grant');
 async function reconcile(id:number){
  const [a]=await sql`select * from billing_accounts where user_id=${id}`;
  const ledger=await sql`select * from credit_transactions where user_id=${id} and ledger_sequence is not null order by ledger_sequence`;
  let balance=a.ledger_opening_balance;let sequence=0;
  for(const row of ledger){assert.equal(Number(row.ledger_sequence),++sequence,'contiguous sequence');balance+=row.amount;assert.equal(row.balance_after,balance,'running balance');assert(row.operation_key,'new ledger entry has operation identity');}
  assert.equal(a.analysis_credits,balance);assert.equal(Number(a.ledger_sequence),sequence);assert.equal((await sql`select analysis_credits from users where id=${id}`)[0].analysis_credits,balance,'legacy balance dualwrite');
  return {balance,sequence};
 }
 for(const user of [signup,seed,administrator]){assert.deepEqual(await reconcile(user.id),{balance:10,sequence:1});assert.equal((await sql`select ledger_opening_balance from billing_accounts where user_id=${user.id}`)[0].ledger_opening_balance,0,'new grant is real ledger, not opening balance');}
 await assert.rejects(sql`update billing_accounts set analysis_credits=-1 where user_id=${signup.id}`,'negative account balance rejected');
 await assert.rejects(sql`insert into credit_transactions(user_id,amount,reason,ledger_sequence) values(${signup.id},1,'malformed-pair',900)`,'sequence requires balanceAfter');
 await assert.rejects(sql`insert into credit_transactions(user_id,amount,reason,balance_after) values(${signup.id},1,'malformed-pair',1)`,'balanceAfter requires sequence');
 await assert.rejects(sql`insert into credit_transactions(user_id,amount,reason,ledger_sequence,balance_after) values(${signup.id},1,'duplicate-sequence',1,11)`,'ledger sequence unique per account');
 await db.transaction((tx:any)=>recordInitialCreditGrant(tx,signup,'signup_grant'));
 assert.deepEqual(await reconcile(signup.id),{balance:10,sequence:1},'repeated initial grant is idempotent');
 await assert.rejects(sql`update credit_transactions set amount=99 where user_id=${signup.id} and ledger_sequence=1`,'sequenced ledger is append only');
 await assert.rejects(sql`delete from credit_transactions where user_id=${signup.id} and ledger_sequence=1`,'sequenced ledger cannot be deleted');
 const mutate=(input:any)=>db.transaction((tx:any)=>mutateCredits(tx,input));
 await mutate({userId:signup.id,amount:1,reason:'scoped-key',operationKey:'same-account-local-key'});
 await mutate({userId:seed.id,amount:1,reason:'scoped-key',operationKey:'same-account-local-key'});
 const debits=await Promise.allSettled([1,2].map(i=>mutate({userId:signup.id,amount:-7,reason:'fixture_debit',operationKey:`debit:${i}`})));
 assert.equal(debits.filter(r=>r.status==='fulfilled').length,1,'only one concurrent debit can spend available balance');assert.deepEqual(await reconcile(signup.id),{balance:4,sequence:3});
 const operation={userId:signup.id,amount:20,reason:'fixture_checkout',operationKey:'checkout:fixture',stripeCheckoutSessionId:'cs_fixture_v2'};
 const duplicate=await Promise.all([mutate(operation),mutate(operation)]);assert.equal(duplicate.filter(r=>r.applied).length,1);assert.deepEqual(await reconcile(signup.id),{balance:24,sequence:4});
 await assert.rejects(mutate({...operation,amount:21}),'same identity with changed amount rejects');
 assert.equal((await mutate({...operation,operationKey:'different-operation'})).applied,false,'checkout replay remains idempotent with different operation key');
 await assert.rejects(mutate({...operation,userId:seed.id,operationKey:'cross-account-checkout'}),'checkout cannot credit a second account');
 await assert.rejects(db.transaction(async(tx:any)=>{await mutateCredits(tx,{userId:signup.id,amount:5,reason:'fixture_rollback',operationKey:'rollback:fixture'});await tx.insert(adminAuditLogs).values({adminUserId:2147483647,action:'fixture',targetType:'user',targetId:signup.id,metadata:'{}'});}));
 assert.deepEqual(await reconcile(signup.id),{balance:24,sequence:4});assert.equal(Number((await sql`select count(*) from credit_transactions where operation_key='rollback:fixture'`)[0].count),0,'audit failure rolls account and ledger back');
 const addModel=async(name:string,provider:string)=>(await db.insert(llmModelConfigs).values({name,provider,baseUrl:'http://127.0.0.1:1',apiKey:'synthetic-fixture-key',modelName:name}).returning())[0];
 const quick=await addModel('fixture-quick','fixture-a'),deep=await addModel('fixture-deep','fixture-b');
 const pin=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));
 const again=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));assert.equal(again.quickModelVersionId,pin.quickModelVersionId,'unchanged config reuses immutable version');
 const [job]=await sql`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts,quick_model_config_id,deep_model_config_id,quick_model_version_id,deep_model_version_id,configuration_state) values(${signup.id},${randomUUID()},'MOCK','2026-10-15','[]',${quick.id},${deep.id},${pin.quickModelVersionId},${pin.deepModelVersionId},'versioned') returning id`;
 await db.update(llmModelConfigs).set({modelName:'fixture-quick-edited'}).where(eq(llmModelConfigs.id,quick.id));
 const next=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));assert.notEqual(next.quickModelVersionId,pin.quickModelVersionId);assert.equal(next.deepModelVersionId,pin.deepModelVersionId);
 assert.equal(next.quickModel,'fixture-quick-edited','display cache uses locked config, not stale caller');
 const oldVersion=await readModelVersion(db,pin.quickModelVersionId);assert.equal(oldVersion.modelName,'fixture-quick');assert.equal(oldVersion.provider,'fixture-a');assert.equal((await readModelVersion(db,pin.deepModelVersionId)).provider,'fixture-b');
 assert.equal((await sql`select quick_model_version_id from analysis_jobs where id=${job.id}`)[0].quick_model_version_id,pin.quickModelVersionId,'queued job stays pinned after edit');
 await assert.rejects(sql`update llm_model_config_versions set model_name='tamper' where id=${pin.quickModelVersionId}`,'versions reject mutation');
 await assert.rejects(sql`delete from llm_model_config_versions where id=${next.quickModelVersionId}`,'versions reject deletion');
 await assert.rejects(sql`update llm_model_configs set current_version_id=${pin.deepModelVersionId} where id=${quick.id}`,'current version belongs to config');
 await assert.rejects(sql`update analysis_jobs set quick_model_version_id=${pin.deepModelVersionId} where id=${job.id}`,'pinned version belongs to selected config');
 await assert.rejects(sql`update analysis_jobs set quick_model_config_id=null where id=${job.id}`,'versioned job cannot bypass config ownership via null');
 await assert.rejects(sql`insert into analysis_model_calls(job_id,call_id,agent,model,role,model_config_id,model_version_id,started_at,status) values(${job.id},'wrong-version-owner','fixture','fixture','quick',${quick.id},${pin.deepModelVersionId},now(),'running')`,'actual call version belongs to recorded config');
 await sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${signup.id},'market','fixture','valid')`;
 await assert.rejects(sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${seed.id},'cross-owner','fixture','invalid')`,'composite report ownership preserved');
 const {markModelQuotaUnavailable}=await import('../../apps/web/lib/analysis/model-availability');
 await db.update(llmModelConfigs).set({apiKey:'synthetic-rotated-key',updatedAt:new Date()}).where(eq(llmModelConfigs.id,quick.id));
 assert.equal(await markModelQuotaUnavailable({id:quick.id,modelVersionId:pin.quickModelVersionId}),false,'delayed old credential failure cannot disable rotated key');
 const rotated=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));
 assert.equal(await markModelQuotaUnavailable({id:quick.id,modelVersionId:rotated.quickModelVersionId}),true,'current credential quota evidence disables the identity');
}
main().catch(error=>{console.error('FAIL database-v2: '+(error?.name || 'Error')+' '+(error?.code || '')+' '+String(error?.stack || '').split('\n').filter(line=>line.includes('scripts/tests/database-v2.ts')).join(' ').trim());process.exitCode=1;});
