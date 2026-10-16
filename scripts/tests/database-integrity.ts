// Fresh-install + pre-migration upgrade + business invariants. Disposable DBs only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
const require=createRequire(import.meta.url),root=process.cwd();
const {drizzle}=require(root+'/apps/web/node_modules/drizzle-orm/postgres-js');
const {migrate}=require(root+'/apps/web/node_modules/drizzle-orm/postgres-js/migrator');
const {initializeAdmin}=require(root+'/scripts/initialize-admin.cjs');
const folder=root+'/apps/web/lib/db/migrations';
async function main() {
 const admin=postgres(process.env.POSTGRES_URL!,{max:1,onnotice:()=>{}}),base=new URL(process.env.POSTGRES_URL!);
 const created:string[]=[],connections:ReturnType<typeof postgres>[]=[];let client:ReturnType<typeof postgres>|undefined;
 const temp=await mkdtemp(path.join(tmpdir(),'stockdepth-integrity-'));
 async function database(kind:string) {const name=`stockdepth_integrity_${kind}_${randomUUID().replaceAll('-','').slice(0,12)}`;await admin.unsafe(`create database "${name}"`);created.push(name);const url=new URL(base);url.pathname='/'+name;const sql=postgres(url.toString(),{max:1,onnotice:()=>{}});connections.push(sql);return {name,url,sql};}
 async function mustReject(sql:ReturnType<typeof postgres>,query:string,code?:string) {await assert.rejects(sql.unsafe(query),e=>!code||(e as {code:string}).code===code);}
 async function validated(sql:ReturnType<typeof postgres>) {assert.equal(Number((await sql`select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and not c.convalidated`)[0].count),0);}
 try {
  const fresh=await database('fresh');
  for(let i=0;i<2;i++) {const result=spawnSync(process.execPath,[root+'/scripts/initialize-database.cjs'],{cwd:root,env:{...process.env,POSTGRES_URL:fresh.url.toString(),STOCKDEPTH_ADMIN_EMAIL:'',STOCKDEPTH_ADMIN_PASSWORD:''},encoding:'utf8'});assert.equal(result.status,0,'real initializer must create/upgrade safely');}
  await validated(fresh.sql);
  for(const table of ['users','analysis_jobs','analysis_reports','analysis_model_calls','credit_transactions','paper_trades'])assert.equal(Number((await fresh.sql.unsafe(`select count(*) from "${table}"`))[0].count),0,'business table is empty: '+table);
  const tableCount=Number((await fresh.sql`select count(*) from pg_tables where schemaname='public'`)[0].count);assert.equal(tableCount,31);
  const columns=await fresh.sql`select is_nullable from information_schema.columns where table_name='credit_transactions' and column_name='user_id'`;assert.equal(columns[0].is_nullable,'NO');
  await initializeAdmin(fresh.sql,{STOCKDEPTH_ADMIN_EMAIL:'fixture-admin@example.test',STOCKDEPTH_ADMIN_PASSWORD:'FixturePassword123!'});
  await initializeAdmin(fresh.sql,{STOCKDEPTH_ADMIN_EMAIL:'fixture-admin@example.test',STOCKDEPTH_ADMIN_PASSWORD:'FixturePassword123!'});
  assert.equal(Number((await fresh.sql`select count(*) from users`)[0].count),1);assert.equal(Number((await fresh.sql`select count(*) from credit_transactions where reason='initial_admin_grant' and amount=10`)[0].count),1);
  const [user]=await fresh.sql`insert into users(email,password_hash) values('fixture@example.test','unused') returning id`;
  const [other]=await fresh.sql`insert into users(email,password_hash) values('other@example.test','unused') returning id`;
  const [job]=await fresh.sql`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts) values(${user.id},${randomUUID()},'MOCK','2026-10-15','[]') returning id`;
  await fresh.sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${user.id},'market','fixture','preserved')`;
  await mustReject(fresh.sql,`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${other.id},'other','fixture','bad')`,'23503');
  await mustReject(fresh.sql,`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${job.id},${user.id},'market','fixture','duplicate')`,'23505');
  await mustReject(fresh.sql,`insert into credit_transactions(user_id,amount,reason) values(null,1,'bad')`,'23502');
  await mustReject(fresh.sql,`insert into credit_transactions(user_id,job_id,amount,reason) values(${other.id},${job.id},1,'bad')`,'23503');
  await fresh.sql`insert into credit_transactions(user_id,amount,reason) values(${user.id},1,'jobless-valid')`;
  await mustReject(fresh.sql,`update analysis_jobs set trade_date='2026-02-30' where id=${job.id}`);
  await mustReject(fresh.sql,`update analysis_jobs set trade_date='2026-99-99' where id=${job.id}`);
  await mustReject(fresh.sql,`update billing_accounts set analysis_credits=-1 where user_id=${user.id}`,'23514');
  process.env.POSTGRES_URL=fresh.url.toString();const databaseModule=await import('../../apps/web/lib/db/drizzle');client=databaseModule.client;const {db}=databaseModule;
  const {adjustCreditBalance}=await import('../../apps/web/lib/credits/admin-adjustment');
  const {recordInitialCreditGrant}=await import('../../apps/web/lib/credits/initial-grant');
  const {users}=await import('../../apps/web/lib/db/schema');
  const {mutateCredits}=await import('../../apps/web/lib/credits/ledger');
  // V2 new accounts start at zero; fund the synthetic fixture through the real ledger.
  await db.transaction(tx=>mutateCredits(tx,{userId:user.id,amount:5,reason:'fixture_funding',operationKey:'fixture-funding:'+user.id}));
  const [actor]=await fresh.sql`select id from users where role='super_admin'`;
  const before=Number((await fresh.sql`select count(*) from credit_transactions`)[0].count);
  assert((await adjustCreditBalance(actor.id,user.id,-10)).error);assert.equal((await fresh.sql`select analysis_credits from billing_accounts where user_id=${user.id}`)[0].analysis_credits,5);assert.equal(Number((await fresh.sql`select count(*) from credit_transactions`)[0].count),before);
  const deductions=await Promise.all([adjustCreditBalance(actor.id,user.id,-4),adjustCreditBalance(actor.id,user.id,-4)]);assert.equal(deductions.filter(r=>r.success).length,1);assert.equal((await fresh.sql`select analysis_credits from billing_accounts where user_id=${user.id}`)[0].analysis_credits,1);
  const [audit]=await fresh.sql`select metadata::jsonb as m from admin_audit_logs where action='user.credits.adjust'`;assert.equal(audit.m.actualAmount,-4);assert.equal(audit.m.previousCredits,5);assert.equal(audit.m.resultingCredits,1);
  const countAfter=Number((await fresh.sql`select count(*) from credit_transactions`)[0].count);await assert.rejects(adjustCreditBalance(2147483647,user.id,10));assert.equal((await fresh.sql`select analysis_credits from billing_accounts where user_id=${user.id}`)[0].analysis_credits,1);assert.equal(Number((await fresh.sql`select count(*) from credit_transactions`)[0].count),countAfter,'audit failure rolls balance and ledger back');
  assert((await adjustCreditBalance(actor.id,user.id,0)).error);
  const registered=await db.transaction(async tx=>{const [newUser]=await tx.insert(users).values({email:'new-signup@example.test',passwordHash:'fixture'}).returning();await recordInitialCreditGrant(tx,newUser,'signup_grant');return newUser;});assert.equal((await fresh.sql`select amount from credit_transactions where user_id=${registered.id}`)[0].amount,10);
  const {analysisDateSchema}=await import('../../apps/web/lib/analysis/date-validation');for(const value of ['2026-02-30','2026-99-99','0000-01-01','2026/10/15'])assert(!analysisDateSchema.safeParse(value).success);for(const value of ['2024-02-29','2026-10-17'])assert(analysisDateSchema.safeParse(value).success);
  const oldFolder=path.join(temp,'migrations');await mkdir(path.join(oldFolder,'meta'),{recursive:true});const journal=JSON.parse(await readFile(path.join(folder,'meta/_journal.json'),'utf8'));const baseline=journal.entries.findIndex((entry:{tag:string})=>entry.tag==='0038_overjoyed_gamora');assert(baseline>=0,'0038 baseline must exist');journal.entries=journal.entries.slice(0,baseline+1);await writeFile(path.join(oldFolder,'meta/_journal.json'),JSON.stringify(journal));for(const entry of journal.entries)await copyFile(path.join(folder,entry.tag+'.sql'),path.join(oldFolder,entry.tag+'.sql'));
  const upgrade=await database('upgrade');await migrate(drizzle(upgrade.sql),{migrationsFolder:oldFolder});
  const [owner]=await upgrade.sql`insert into users(email,password_hash,analysis_credits) values('legacy@example.test','fixture',17) returning id`;const [wrong]=await upgrade.sql`insert into users(email,password_hash) values('wrong@example.test','fixture') returning id`;
  const [legacy]=await upgrade.sql`insert into analysis_jobs(user_id,run_id,ticker,trade_date,analysts) values(${owner.id},${randomUUID()},'MOCK','2026-10-15','[]') returning id`;
  const [report]=await upgrade.sql`insert into analysis_reports(job_id,user_id,report_key,title,content) values(${legacy.id},${wrong.id},'market','legacy','DO NOT DELETE') returning id`;
  await assert.rejects(migrate(drizzle(upgrade.sql),{migrationsFolder:folder}));assert.equal((await upgrade.sql`select content from analysis_reports where id=${report.id}`)[0].content,'DO NOT DELETE');
  await upgrade.sql`update analysis_reports set user_id=${owner.id} where id=${report.id}`;
  await migrate(drizzle(upgrade.sql),{migrationsFolder:folder});await migrate(drizzle(upgrade.sql),{migrationsFolder:folder});await validated(upgrade.sql);
  assert.equal((await upgrade.sql`select content from analysis_reports where id=${report.id}`)[0].content,'DO NOT DELETE');assert.equal((await upgrade.sql`select analysis_credits from billing_accounts where user_id=${owner.id}`)[0].analysis_credits,17);assert.equal(Number((await upgrade.sql`select count(*) from credit_transactions`)[0].count),0,'historical opening balances are not invented');
  console.log('PASS: real empty-DB initialization twice, 31 tables, all constraints validated, report ownership/uniqueness, ledger ownership/non-null, calendar dates, atomic concurrent credits/audit rollback, initial grants, historical preservation, unsafe migration rejection and upgrade idempotency. No providers or email.');
 }finally{if(client)await client.end();for(const sql of connections)await sql.end();for(const name of created)await admin.unsafe(`drop database if exists "${name}" with (force)`);await admin.end();await rm(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error('FAIL database-integrity: '+(e?.name || 'Error')+' '+(e?.code || '')+' '+String(e?.stack || '').split('\n').filter(line=>line.includes('scripts/tests/database-integrity.ts')).join(' ').trim());process.exitCode=1;});
