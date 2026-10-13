// Creates its own database and fixtures. Never starts workers on the project DB.
const path=require('node:path'), fs=require('node:fs'), {spawn}=require('node:child_process'), {randomUUID,randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..'), modules=root+'/apps/web/node_modules';
require(modules+'/dotenv').config({path:root+'/.env'});
if(!['127.0.0.1','localhost','::1','[::1]'].includes(new URL(process.env.POSTGRES_URL).hostname))throw Error('Local isolated DB required');
const postgres=require(modules+'/postgres'), {drizzle}=require(modules+'/drizzle-orm/postgres-js'), {migrate}=require(modules+'/drizzle-orm/postgres-js/migrator');
const name='stockdepth_stage1_s3_worker_'+randomUUID().replaceAll('-','');
const output=root+'/var/performance/stage3-worker'; fs.mkdirSync(output,{recursive:true});
const runtime=process.env.STOCKDEPTH_RUNTIME_BIN;
if(!runtime || !fs.existsSync(runtime+'/tsx')) throw Error('Project runtime required');
const admin=postgres(process.env.POSTGRES_URL,{max:1});let created=false,test;
(async()=>{try{
 await admin`create database ${admin(name)}`;created=true;
 const url=new URL(process.env.POSTGRES_URL);url.pathname='/'+name;
 test=postgres(url.toString(),{max:1});
 await migrate(drizzle(test),{migrationsFolder:root+'/apps/web/lib/db/migrations'});
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(runtime+'/tsx',['tests/stage1-stability.ts'],{cwd:root+'/apps/workers',env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|PASSWORD|DATABASE|POSTGRES|MODEL_CONFIG)/i.test(key))),POSTGRES_URL:url.toString(),
    STOCKDEPTH_MODEL_KEY_ID:'test',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({test:randomBytes(32).toString('base64url')}),
    PAPER_TRADER_AUTO_EXECUTE:'false',PAPER_TRADER_MODEL_TIMEOUT_MS:'1000',STAGE1_TEST_OUTPUT:output+'/worker-stability.json',
    PATH:runtime+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  child.on('error',reject);child.on('close',value=>{clearTimeout(timer);resolve(value);});
 });
 if(code!==0)throw Error('Isolated worker tests failed');
 console.log('Isolated worker tests passed.');
}finally{if(test)await test.end();if(created)await admin`drop database ${admin(name)} with (force)`;await admin.end();}
})().catch(error=>{console.error('Stage-one tests failed:',error.code||error.name);process.exitCode=1;});
