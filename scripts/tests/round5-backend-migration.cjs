// Private cluster only. Creates new old/fresh databases; never accepts a database URL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),modules=root+'/apps/web/node_modules';
const postgres=require(modules+'/postgres'),{drizzle}=require(modules+'/drizzle-orm/postgres-js'),{migrate}=require(modules+'/drizzle-orm/postgres-js/migrator');
const prefix=process.env.ROUND5_TEST_DATABASE;assert.match(prefix||'',/^stockdepth_round5_backend_[a-z0-9_]+$/);
const admin=postgres('postgres://ubuntu@127.0.0.1:55483/postgres',{max:1});
const folder=root+'/apps/web/lib/db/migrations',journal=JSON.parse(fs.readFileSync(folder+'/meta/_journal.json'));
async function identity(db,name){const [i]=await db`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;assert.equal(i.name,name);assert.equal(i.host,'127.0.0.1/32');assert.equal(i.port,55483);}
async function assets(db){const data = {portfolios:await db`select id,user_id,name,initial_cash_cents,cash_cents,currency,status,auto_trade_enabled,created_at,updated_at from paper_portfolios order by id`,positions:await db`select id,portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents,created_at,updated_at from paper_positions order by id`,trades:await db`select id,portfolio_id,user_id,position_id,decision_id,ticker,side,quantity,price_cents,gross_amount_cents,fee_cents,realized_pnl_cents,note,created_at from paper_trades order by id`}; for(const rows of Object.values(data))for(const row of rows)for(const key of Object.keys(row))if(key.endsWith("_cents"))row[key]=String(row[key]);return data;}
(async()=>{await identity(admin,'postgres');
for(const mode of ['old','pre_round4','fresh']) {
 const name=prefix+'_'+mode;await admin.unsafe('CREATE DATABASE "'+name+'"');const db=postgres('postgres://ubuntu@127.0.0.1:55483/'+name,{max:1});
 try {await identity(db,name);assert.equal((await db`select tablename from pg_tables where schemaname='public'`).length,0);
 let before;
 if(mode!=='fresh') {
   const temp=fs.mkdtempSync(root+'/var/codex-team-round5/backend-old-migrations-');fs.mkdirSync(temp+'/meta');
   const old={...journal,entries:journal.entries.filter(e=>e.idx<(mode==='old'?29:26))};fs.writeFileSync(temp+'/meta/_journal.json',JSON.stringify(old));
   for(const e of old.entries) fs.copyFileSync(folder+'/'+e.tag+'.sql',temp+'/'+e.tag+'.sql');
   try {await migrate(drizzle(db),{migrationsFolder:temp});}finally{fs.rmSync(temp,{recursive:true});}
   const [u]=await db`insert into users(email,password_hash) values('old@isolated.invalid','test-only') returning id`;
   const [p]=await db`insert into paper_portfolios(user_id,initial_cash_cents,cash_cents) values(${u.id},10000,9700) returning id`;
   const [q]=await db`insert into paper_positions(portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents) values(${p.id},${u.id},'UNCONFIRMED',3,100,120,25) returning id`;
   await db`insert into paper_trades(portfolio_id,user_id,position_id,ticker,side,quantity,price_cents,gross_amount_cents) values(${p.id},${u.id},${q.id},'UNCONFIRMED','buy',3,100,300)`;
   // Old single-column FKs permit this inconsistent historical owner. Preserve it.
   const [other]=await db`insert into users(email,password_hash) values('legacy-other@isolated.invalid','test-only') returning id`;
   await db`insert into paper_positions(portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents) values(${p.id},${other.id},'LEGACY',0,2147483647,2147483647,-2147483648)`;
   // Simulate a pre-existing NOT VALID CHECK anomaly without cleaning it.
   await db`alter table paper_positions drop constraint paper_positions_amounts_nonnegative`;
   await db`insert into paper_positions(portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents) values(${p.id},${u.id},'LEGACY_CHECK',-1,-100,-100)`;
   await db`alter table paper_positions add constraint paper_positions_amounts_nonnegative check(quantity>=0 and avg_cost_cents>=0 and last_price_cents>=0) not valid`;
   before=await assets(db);
 }
 await migrate(drizzle(db),{migrationsFolder:folder});await migrate(drizzle(db),{migrationsFolder:folder});
 if(before)assert.deepEqual(await assets(db),before);
 const [m]=await db`select count(*)::int as count from drizzle.__drizzle_migrations`;assert.equal(m.count,journal.entries.length);
 const cents=await db`select table_name,column_name,data_type from information_schema.columns where table_schema='public' and column_name like '%_cents' order by table_name,column_name`;
 assert.equal(cents.length,10);assert(cents.every(c=>c.data_type==='bigint'));
 const newConstraints=await db`select conname,contype,convalidated from pg_constraint where connamespace='public'::regnamespace and (conname like '%_safe' or conname in ('paper_runs_portfolio_owner_fk','paper_runs_job_owner_fk','paper_runs_watchlist_owner_fk','paper_positions_portfolio_owner_fk','paper_decisions_portfolio_owner_fk','paper_decisions_run_scope_job_fk','paper_requests_portfolio_owner_fk','paper_trades_portfolio_owner_fk','paper_trades_position_scope_fk','paper_trades_decision_scope_fk'))`;
 assert.equal(newConstraints.length,20);assert(newConstraints.every(c=>!c.convalidated));
 const historicalChecks=await db`select conname,convalidated from pg_constraint where conname in ('paper_portfolios_cash_nonnegative','paper_positions_amounts_nonnegative','paper_trades_amounts_valid')`;
 assert.equal(historicalChecks.length,3);assert(historicalChecks.every(c=>!c.convalidated));
 if(before){
   const {execFileSync}=require('node:child_process');
   const caseFile=root+`/var/codex-team-round5/legacy-process-case-${process.pid}-${mode}.json`;
   fs.writeFileSync(caseFile,JSON.stringify({fixture:{user:{id:1},portfolio:{id:1}},key:crypto.randomUUID()}));
   try{
     const result=JSON.parse(execFileSync(process.execPath,[root+'/scripts/tests/round5-backend.cjs','--process-trade-only'],{cwd:root,env:{...process.env,ROUND3_TEST_DATABASE:name,ROUND3_PROCESS_CASE:caseFile},encoding:'utf8'}).trim());
     assert.equal(result.status,400);assert.match(result.body.error,/ownership mismatch/);
     assert.deepEqual(await assets(db),before);
   }finally{fs.unlinkSync(caseFile);}
 }
 const tables=await db`select tablename from pg_tables where schemaname='public'`;assert.equal(tables.length,23);
 const shared=['instruments','instrument_sources','price_snapshots','daily_prices','market_sync_state','market_sync_runs'];
 const owners=await db`select table_name from information_schema.columns where table_name in ${db(shared)} and column_name='user_id'`;assert.equal(owners.length,0);
 const [linked]=await db`select count(*)::int as n from paper_positions where instrument_id is not null`;assert.equal(linked.n,0);
 const [snapshots]=await db`select count(*)::int as n from instruments`;assert.equal(snapshots.n,0);
 console.log(JSON.stringify({test:mode+' machine full migration/repeat',database:name,migrations:m.count,tables:tables.length,historicalAssetsUnchanged:true,historicalCheckAnomalyPreserved:mode!=='fresh',transactionRereadRejectsLegacyMismatch:mode!=='fresh',legacyMismatchPreserved:mode!=='fresh',bigintColumns:10,newNotValidConstraints:20,noGuessedBackfill:true,pass:true}));
 }finally{await db.end();}
}
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>admin.end());
