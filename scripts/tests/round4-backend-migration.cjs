// Private cluster only. Creates new old/fresh databases; never accepts a database URL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),modules=root+'/apps/web/node_modules';
const postgres=require(modules+'/postgres'),{drizzle}=require(modules+'/drizzle-orm/postgres-js'),{migrate}=require(modules+'/drizzle-orm/postgres-js/migrator');
const prefix=process.env.ROUND4_TEST_DATABASE;assert.match(prefix||'',/^stockdepth_round4_backend_[a-z0-9_]+$/);
const admin=postgres('postgres://ubuntu@127.0.0.1:55483/postgres',{max:1});
const folder=root+'/apps/web/lib/db/migrations',journal=JSON.parse(fs.readFileSync(folder+'/meta/_journal.json'));
async function identity(db,name){const [i]=await db`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;assert.equal(i.name,name);assert.equal(i.host,'127.0.0.1/32');assert.equal(i.port,55483);}
async function assets(db){return {portfolios:await db`select id,user_id,name,initial_cash_cents,cash_cents,currency,status,auto_trade_enabled,created_at,updated_at from paper_portfolios order by id`,positions:await db`select id,portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents,created_at,updated_at from paper_positions order by id`,trades:await db`select id,portfolio_id,user_id,position_id,decision_id,ticker,side,quantity,price_cents,gross_amount_cents,fee_cents,realized_pnl_cents,note,created_at from paper_trades order by id`};}
(async()=>{await identity(admin,'postgres');
for(const mode of ['old','fresh']) {
 const name=prefix+'_'+mode;await admin.unsafe('CREATE DATABASE "'+name+'"');const db=postgres('postgres://ubuntu@127.0.0.1:55483/'+name,{max:1});
 try {await identity(db,name);assert.equal((await db`select tablename from pg_tables where schemaname='public'`).length,0);
 let before;
 if(mode==='old') {
   const temp=fs.mkdtempSync(root+'/var/codex-team-round4/backend-old-migrations-');fs.mkdirSync(temp+'/meta');
   const old={...journal,entries:journal.entries.filter(e=>e.idx<26)};fs.writeFileSync(temp+'/meta/_journal.json',JSON.stringify(old));
   for(const e of old.entries) fs.copyFileSync(folder+'/'+e.tag+'.sql',temp+'/'+e.tag+'.sql');
   try {await migrate(drizzle(db),{migrationsFolder:temp});}finally{fs.rmSync(temp,{recursive:true});}
   const [u]=await db`insert into users(email,password_hash) values('old@isolated.invalid','test-only') returning id`;
   const [p]=await db`insert into paper_portfolios(user_id,initial_cash_cents,cash_cents) values(${u.id},10000,9700) returning id`;
   const [q]=await db`insert into paper_positions(portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents) values(${p.id},${u.id},'UNCONFIRMED',3,100,120,25) returning id`;
   await db`insert into paper_trades(portfolio_id,user_id,position_id,ticker,side,quantity,price_cents,gross_amount_cents) values(${p.id},${u.id},${q.id},'UNCONFIRMED','buy',3,100,300)`;
   before=await assets(db);
 }
 await migrate(drizzle(db),{migrationsFolder:folder});await migrate(drizzle(db),{migrationsFolder:folder});
 if(before)assert.deepEqual(await assets(db),before);
 const [m]=await db`select count(*)::int as count from drizzle.__drizzle_migrations`;assert.equal(m.count,journal.entries.length);
 const tables=await db`select tablename from pg_tables where schemaname='public'`;assert.equal(tables.length,23);
 const shared=['instruments','instrument_sources','price_snapshots','daily_prices','market_sync_state','market_sync_runs'];
 const owners=await db`select table_name from information_schema.columns where table_name in ${db(shared)} and column_name='user_id'`;assert.equal(owners.length,0);
 const [linked]=await db`select count(*)::int as n from paper_positions where instrument_id is not null`;assert.equal(linked.n,0);
 const [snapshots]=await db`select count(*)::int as n from instruments`;assert.equal(snapshots.n,0);
 console.log(JSON.stringify({test:mode+' machine full migration/repeat',database:name,migrations:m.count,tables:tables.length,historicalAssetsUnchanged:true,noGuessedBackfill:true,pass:true}));
 }finally{await db.end();}
}
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>admin.end());
