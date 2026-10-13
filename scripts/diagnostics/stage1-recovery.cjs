// Same mock latency before/after; all queues live in a newly created local DB.
const fs=require('node:fs'), path=require('node:path'), {spawn}=require('node:child_process'), {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../..'), modules=root+'/apps/web/node_modules';
require(modules+'/dotenv').config({path:root+'/.env'});
const sourceUrl=new URL(process.env.POSTGRES_URL);
if(!['127.0.0.1','localhost','::1','[::1]'].includes(sourceUrl.hostname))throw Error('Local test database required');
const postgres=require(modules+'/postgres'),{drizzle}=require(modules+'/drizzle-orm/postgres-js'),{migrate}=require(modules+'/drizzle-orm/postgres-js/migrator');
const admin=postgres(sourceUrl.toString(),{max:1});
const name='stockdepth_stage1_'+randomUUID().replaceAll('-','');
const directory=root+'/var/performance/stage1-implementation';fs.mkdirSync(directory,{recursive:true});
const runtime=process.env.STOCKDEPTH_RUNTIME_BIN;
const beforeFile=root+'/apps/workers/src/.stage1-before-worker.fixture.ts';
const original=root+'/var/performance/stage1-implementation/before/apps/workers/src/analysis-worker.ts';
if(!runtime||!fs.existsSync(original)||fs.existsSync(beforeFile))throw Error('Preserved baseline required; will not overwrite a fixture');
let before=fs.readFileSync(original,'utf8');
before=before.replace('async function processMockJob(job: ClaimedJob) {', `async function processMockJob(job: ClaimedJob) {
  console.log(JSON.stringify({event:'mock_execution_start',jobId:job.id}));
  await sleep(300);`);
before=before.replace('  console.log(`Mock completed analysis job #${job.id}`);', '  console.log(`Mock completed analysis job #${job.id}`);\n  console.log(JSON.stringify({event:\'mock_execution_end\',jobId:job.id}));');
fs.writeFileSync(beforeFile,before);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const workers=new Set();let created=false,test;const results=[];
async function stop(child,signal='SIGTERM'){
 if(child.exitCode===null&&child.signalCode===null){process.kill(-child.pid,signal);await new Promise(resolve=>child.once('close',resolve));}
 workers.delete(child);
}
function memoryTree(pid){
 const all=new Map();for(const entry of fs.readdirSync('/proc').filter(value=>/^\d+$/.test(value))){try{
  const status=fs.readFileSync(`/proc/${entry}/status`,'utf8');
  const raw=fs.readFileSync(`/proc/${entry}/stat`,'utf8'),stat=raw.slice(raw.lastIndexOf(')')+2).split(' ');
  all.set(Number(entry),{parent:Number(status.match(/PPid:\s+(\d+)/)?.[1]),rss:Number(status.match(/VmRSS:\s+(\d+)/)?.[1]||0),ticks:Number(stat[11])+Number(stat[12])});
 }catch{}}
 const ids=new Set([pid]);let changed=true;while(changed){changed=false;for(const [id,p] of all)if(ids.has(p.parent)&&!ids.has(id)){ids.add(id);changed=true;}}
 return [...ids].reduce((sum,id)=>({rss:sum.rss+(all.get(id)?.rss||0),ticks:sum.ticks+(all.get(id)?.ticks||0)}),{rss:0,ticks:0});
}
async function scenario(mode,round,workerCount=1,restart=false){
 await test`delete from analysis_reports`;await test`delete from analysis_jobs`;
 await test`insert into analysis_worker_settings(key,system_concurrency,user_concurrency) values('analysis_worker',2,10)
   on conflict(key) do update set system_concurrency=2,user_concurrency=10`;
 const [user]=await test`select id from users limit 1`;
 await test`insert into analysis_jobs ${test(Array.from({length:restart?4:8},(_,i)=>({user_id:user.id,run_id:'recovery-'+randomUUID(),ticker:'MOCK',trade_date:'2026-10-13',analysts:'[]',provider:'mock',base_url:'mock://isolated',status:'running'})))}`;
 const expected=restart?4:8,active=new Set(),starts=new Map();let peak=0,firstStart=0,lastEnd=0,maxRssKb=0,maxCpuTicks=0;
 const children=[];
 const launch=()=>{
  const file=mode==='before'?beforeFile:root+'/apps/workers/src/analysis-worker.ts';
  const child=spawn(runtime+'/tsx',[file],{cwd:root+'/apps/workers',detached:true,env:{...process.env,POSTGRES_URL:testUrl,
    ANALYSIS_WORKER_MOCK:'true',ANALYSIS_WORKER_MOCK_DELAY_MS:restart?'1500':'300',ANALYSIS_WORKER_MAX_CONCURRENCY:'2',
    ANALYSIS_WORKER_LEASE_MS:'3000',ANALYSIS_WORKER_POLL_MS:'50',ANALYSIS_PROVIDER_CONCURRENCY:'10',
    STOCKDEPTH_API_URL:'http://127.0.0.1:1',PATH:runtime+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  workers.add(child);children.push(child);let pending='';
  child.stdout.on('data',chunk=>{pending+=chunk.toString();let newline;while((newline=pending.indexOf('\n'))>=0){
   const line=pending.slice(0,newline);pending=pending.slice(newline+1);let event;try{event=JSON.parse(line);}catch{continue;}
   if(event.event==='mock_execution_start'){active.add(child.pid+':'+event.jobId);starts.set(event.jobId,(starts.get(event.jobId)||0)+1);firstStart ||= Date.now();peak=Math.max(peak,active.size);}
   if(event.event==='mock_execution_end'){active.delete(child.pid+':'+event.jobId);lastEnd=Date.now();}
  }});
  child.stderr.resume();return child;
 };
 for(let i=0;i<workerCount;i++)launch();
 const start=Date.now();let killed=false;
 try{
  while(Date.now()-start<20000){
   if(restart&&!killed&&active.size===2){const child=children[0];await stop(child,'SIGKILL');for(const key of [...active])if(key.startsWith(child.pid+':'))active.delete(key);launch();killed=true;}
   let rss=0,ticks=0;for(const child of workers){const snapshot=memoryTree(child.pid);rss+=snapshot.rss;ticks+=snapshot.ticks;}
   maxRssKb=Math.max(maxRssKb,rss);maxCpuTicks=Math.max(maxCpuTicks,ticks);
   const [counts]=await test`select count(*) filter(where status='complete')::int as complete,count(*) filter(where status='failed')::int as failed from analysis_jobs`;
   if(counts.failed)throw Error('Mock recovery failed');
   if(counts.complete===expected)break;
   if([...workers].some(child=>child.exitCode!==null||child.signalCode!==null))throw Error('Mock worker exited');
   await sleep(50);
  }
  await sleep(50);
  const [count]=await test`select count(*) filter(where status='complete')::int as complete,count(worker_owner)::int as owners from analysis_jobs`;
  if(count.complete!==expected||count.owners!==0)throw Error('Recovery completion or lease release failed');
  if(mode==='after'&&peak>2)throw Error('Recovery exceeded global cap');
  if(!restart&&[...starts.values()].some(value=>value!==1))throw Error('Duplicate mock execution');
  const result={mode,round,workerCount,restart,jobs:expected,peakActive:peak,executionMs:lastEnd-firstStart,wallMs:Date.now()-start,maxRssKb,maxCpuTicks};
  results.push(result);console.log(JSON.stringify(result));
 }finally{for(const child of [...workers])await stop(child);}
}
let testUrl;
(async()=>{try{
 await admin`create database ${admin(name)}`;created=true;sourceUrl.pathname='/'+name;testUrl=sourceUrl.toString();
 test=postgres(testUrl,{max:2});await migrate(drizzle(test),{migrationsFolder:root+'/apps/web/lib/db/migrations'});
 await test`insert into users(email,password_hash,analysis_credits) values('mock-recovery@test.invalid','unused',100)`;
 for(let round=1;round<=3;round++){await scenario('before',round);await scenario('after',round);}
 await scenario('after',4,2);await scenario('after',5,1,true);
 fs.writeFileSync(directory+'/recovery-comparison.json',JSON.stringify({scope:'Mock queue/report writes only; no Python/LLM or trading. Before fixture differs only by injected matching latency/events.',results},null,2));
}finally{for(const child of [...workers])await stop(child);if(test)await test.end();if(created)await admin`drop database ${admin(name)} with (force)`;await admin.end();fs.rmSync(beforeFile,{force:true});}
})().catch(error=>{console.error('Recovery comparison failed:',error.code||error.name);process.exitCode=1;});
