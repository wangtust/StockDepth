const assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),postgres=require(root+'/apps/web/node_modules/postgres');
const name=process.env.ROUND4_TEST_DATABASE;assert.match(name||'',/^stockdepth_round4_backend_[a-z0-9_]+$/);
const url='postgres://ubuntu@127.0.0.1:55483/'+name,db=postgres(url,{max:1,onnotice(){}});
(async()=>{const [i]=await db`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;assert.equal(i.name,name);assert.equal(i.host,'127.0.0.1/32');assert.equal(i.port,55483);assert.equal((await db`select tablename from pg_tables where schemaname='public'`).length,0);
const env={...process.env,POSTGRES_URL:url,NODE_OPTIONS:'--require='+root+'/scripts/tests/round4-no-dotenv.cjs'};delete env.STOCKDEPTH_ADMIN_EMAIL;delete env.STOCKDEPTH_ADMIN_PASSWORD;
for(let n=0;n<2;n++) process.stdout.write(execFileSync(process.execPath,[root+'/scripts/initialize-database.cjs'],{cwd:root,env,encoding:'utf8'}));
assert.equal((await db`select tablename from pg_tables where schemaname='public'`).length,23);assert.equal((await db`select * from users`).length,0);console.log(JSON.stringify({test:'real initialization on empty private machine and repeated initialization',tables:23,pass:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
