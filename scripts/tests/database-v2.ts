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
  const [legacy]=await upgrade.sql`insert into users(email,password_hash,analysis_credits,stripe_customer_id,stripe_subscription_id,stripe_product_id,plan_name,subscription_status) values('legacy-v2@example.test','fixture',37,'cus_fixture','sub_fixture','prod_fixture','Fixture plan','active') returning id`;
  await upgrade.sql`insert into credit_transactions(user_id,amount,reason) values(${legacy.id},7,'legacy-evidence')`;
  const {encryptModelKey}=await import('../../apps/web/lib/security/model-key');
  const migrationKeys={STOCKDEPTH_MODEL_KEY_ID:'migration-fixture',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({'migration-fixture':randomBytes(32).toString('base64url')})};
  const legacyCiphertext=encryptModelKey('synthetic-migration-key',migrationKeys);
  const [legacyModel]=await upgrade.sql`insert into llm_model_configs(name,provider,base_url,api_key,model_name,model_options,input_price,cache_price,output_price) values('historical model','fixture-provider','http://127.0.0.1:1',${legacyCiphertext},'historical-model','{"temperature":0.2}',1.123456,0.123456,2.123456) returning id`;
  const [placeholderModel]=await upgrade.sql`insert into llm_model_configs(name,provider,base_url,api_key,model_name,is_active,is_default) values('missing key placeholder','fixture-placeholder','http://127.0.0.1:2','','placeholder-model',true,true) returning id`;

  const [job]=await upgrade.sql`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts) values(${legacy.id},${randomUUID()},'MOCK','2026-10-15','[]') returning id`;
  await upgrade.sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${legacy.id},'market','legacy','PRESERVE')`;
  for(let i=0;i<2;i++)await migrate(drizzle(upgrade.sql),{migrationsFolder:folder});
  const [normalizedModel]=await upgrade.sql`select c.*,v.provider,v.base_url,v.model_name,v.model_options,v.encrypted_api_key,v.input_price,v.cache_price,v.output_price from llm_model_configs c join llm_model_config_versions v on v.id=c.current_version_id and v.config_id=c.id where c.id=${legacyModel.id}`;
  assert.equal(normalizedModel.encrypted_api_key,legacyCiphertext);assert.equal(normalizedModel.provider,'fixture-provider');assert.equal(normalizedModel.model_name,'historical-model');assert.deepEqual(normalizedModel.model_options,{temperature:0.2});assert.equal(normalizedModel.input_price,'1.123456');assert.equal(normalizedModel.cache_price,'0.123456');assert.equal(normalizedModel.output_price,'2.123456');
  const [placeholder]=await upgrade.sql`select c.is_active,c.is_default,v.encrypted_api_key,v.model_name from llm_model_configs c join llm_model_config_versions v on v.id=c.current_version_id where c.id=${placeholderModel.id}`;
  assert.equal(placeholder.encrypted_api_key,null);assert.equal(placeholder.model_name,'placeholder-model');assert.equal(placeholder.is_active,false);assert.equal(placeholder.is_default,false);
  assert.equal((await upgrade.sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='llm_model_configs' and column_name in ('provider','base_url','api_key','model_name','model_options','input_price','cache_price','output_price')`)[0].n,0,'identity table has no duplicate execution fields');
  const [account]=await upgrade.sql`select * from billing_accounts where user_id=${legacy.id}`;
  assert(account,'migration creates historical billing account');assert.equal(account.stripe_customer_id,'cus_fixture');assert.equal(account.stripe_subscription_id,'sub_fixture');assert.equal(account.stripe_product_id,'prod_fixture');assert.equal(account.plan_name,'Fixture plan');assert.equal(account.subscription_status,'active');assert.equal(account.analysis_credits,37);assert.equal(account.ledger_opening_balance,37);assert.equal(Number(account.ledger_sequence),0);
  const rows=await upgrade.sql`select * from credit_transactions where user_id=${legacy.id}`;
  assert.equal(rows.length,1,'no fabricated historical grants');assert.equal(rows[0].ledger_sequence,null);assert.equal(rows[0].balance_after,null);assert.equal(rows[0].reason,'legacy-evidence');
  const [unknown]=await upgrade.sql`select * from analysis_jobs where id=${job.id}`;
  assert.equal(unknown.quick_model_version_id,null);assert.equal(unknown.deep_model_version_id,null);assert.equal(unknown.charged_credits,null,'unknown old charge remains unknown');
  assert.equal((await upgrade.sql`select content from analysis_reports where job_id=${job.id}`)[0].content,'PRESERVE');
  const fresh=await database('fresh');
  for(let i=0;i<2;i++){const result=spawnSync(process.execPath,[root+'/scripts/initialize-database.cjs'],{cwd:root,env:{...process.env,POSTGRES_URL:fresh.url.toString(),STOCKDEPTH_ADMIN_EMAIL:'',STOCKDEPTH_ADMIN_PASSWORD:''},encoding:'utf8'});assert.equal(result.status,0,'initializer succeeds on fresh DB and repeat');}
  assert.equal(Number((await fresh.sql`select count(*) from pg_tables where schemaname='public'`)[0].count),31);
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
  assert.equal(a.analysis_credits,balance);assert.equal(Number(a.ledger_sequence),sequence);assert.equal((await sql`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('analysis_credits','stripe_customer_id','stripe_subscription_id','stripe_product_id','plan_name','subscription_status')`)[0].n,0,'users has no duplicate billing fields');
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
 const {createModelFixture,updateModelFixture}=await import('./model-fixture');
 const addModel=async(name:string,provider:string)=>createModelFixture(db,{name,provider});
 const quick=await addModel('fixture-quick','fixture-a'),deep=await addModel('fixture-deep','fixture-b');
 const pin=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));
 const again=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));assert.equal(again.quickModelVersionId,pin.quickModelVersionId,'unchanged config reuses immutable version');
 const [job]=await sql`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts,quick_model_version_id,deep_model_version_id,configuration_state) values(${signup.id},${randomUUID()},'MOCK','2026-10-15','[]',${pin.quickModelVersionId},${pin.deepModelVersionId},'versioned') returning id`;
 await updateModelFixture(db,quick.id,{modelName:'fixture-quick-edited'});
 const next=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));assert.notEqual(next.quickModelVersionId,pin.quickModelVersionId);assert.equal(next.deepModelVersionId,pin.deepModelVersionId);
 assert.equal((await readModelVersion(db,next.quickModelVersionId)).modelName,'fixture-quick-edited','execution config comes from current version, not stale caller');
 const oldVersion=await readModelVersion(db,pin.quickModelVersionId);assert.equal(oldVersion.modelName,'fixture-quick');assert.equal(oldVersion.provider,'fixture-a');assert.equal((await readModelVersion(db,pin.deepModelVersionId)).provider,'fixture-b');
 assert.equal((await sql`select quick_model_version_id from analysis_jobs where id=${job.id}`)[0].quick_model_version_id,pin.quickModelVersionId,'queued job stays pinned after edit');
 await assert.rejects(sql`update llm_model_config_versions set model_name='tamper' where id=${pin.quickModelVersionId}`,'versions reject mutation');
 await assert.rejects(sql`delete from llm_model_config_versions where id=${next.quickModelVersionId}`,'versions reject deletion');
 await assert.rejects(sql`update llm_model_configs set current_version_id=${pin.deepModelVersionId} where id=${quick.id}`,'current version belongs to config');
 await assert.rejects(sql`update analysis_jobs set quick_model_version_id=null where id=${job.id}`,'versioned jobs require both immutable versions');
 await assert.rejects(sql`insert into analysis_model_calls(job_id,call_id,agent,model,role,model_config_id,model_version_id,started_at,status) values(${job.id},'wrong-version-owner','fixture','fixture','quick',${quick.id},${pin.deepModelVersionId},now(),'running')`,'actual call version belongs to recorded config');
 await sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${signup.id},'market','fixture','valid')`;
 await assert.rejects(sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${seed.id},'cross-owner','fixture','invalid')`,'composite report ownership preserved');
 const {markModelQuotaUnavailable}=await import('../../apps/web/lib/analysis/model-availability');
 await updateModelFixture(db,quick.id,{apiKey:'synthetic-rotated-key',updatedAt:new Date()});
 assert.equal(await markModelQuotaUnavailable({id:quick.id,modelVersionId:pin.quickModelVersionId}),false,'delayed old credential failure cannot disable rotated key');
 const rotated=await db.transaction((tx:any)=>pinModelVersions(tx,quick,deep));
 assert.equal(await markModelQuotaUnavailable({id:quick.id,modelVersionId:rotated.quickModelVersionId}),true,'current credential quota evidence disables the identity');
 // Operator key rotation appends new versions and keeps the old keyring usable for historical tasks.
 const [beforeRotation]=await sql`select encrypted_api_key from llm_model_config_versions where id=${rotated.quickModelVersionId}`;
 const keyring=JSON.parse(process.env.STOCKDEPTH_MODEL_KEYRING!);keyring.rotated=randomBytes(32).toString('base64url');
 const rotationEnvironment={...process.env,STOCKDEPTH_MODEL_READERS_READY:'true',STOCKDEPTH_MODEL_KEY_ID:'rotated',STOCKDEPTH_MODEL_KEYRING:JSON.stringify(keyring)};
 const rotateKeys=(args:string[])=>{const result=spawnSync(process.execPath,[root+'/apps/workers/node_modules/tsx/dist/cli.mjs',root+'/scripts/model-key-migrate.ts',...args],{cwd:root,env:rotationEnvironment,encoding:'utf8'});assert.equal(result.status,0,'version-only key rotation succeeds');return JSON.parse(result.stdout.trim());};
 assert(rotateKeys(['--rotate']).candidates>=2,'dry-run identifies old current envelopes');
 assert(rotateKeys(['--rotate','--apply']).candidates>=2,'rotation appends current key versions');
 assert.equal(rotateKeys(['--rotate','--apply']).candidates,0,'repeated rotation is idempotent');
 const [afterRotation]=await sql`select c.current_version_id,v.encrypted_api_key from llm_model_configs c join llm_model_config_versions v on v.id=c.current_version_id and v.config_id=c.id where c.id=${quick.id}`;
 assert.notEqual(afterRotation.current_version_id,rotated.quickModelVersionId);assert(afterRotation.encrypted_api_key.startsWith('sdkey:v1:rotated:'));
 assert.equal((await sql`select encrypted_api_key from llm_model_config_versions where id=${rotated.quickModelVersionId}`)[0].encrypted_api_key,beforeRotation.encrypted_api_key,'historical ciphertext never rewritten');
 const {decryptModelKey}=await import('../../apps/web/lib/security/model-key');
 assert.equal(decryptModelKey(afterRotation.encrypted_api_key,rotationEnvironment),'synthetic-rotated-key');
 assert.equal(decryptModelKey(beforeRotation.encrypted_api_key,rotationEnvironment),'synthetic-rotated-key','retained old key decrypts historical version');

}
main().catch(error=>{console.error('FAIL database-v2: '+(error?.name || 'Error')+' '+(error?.code || '')+' '+String(error?.stack || '').split('\n').filter(line=>line.includes('scripts/tests/database-v2.ts')).join(' ').trim());process.exitCode=1;});
