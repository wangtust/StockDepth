// Read-only, sequential baseline. No task submission, paid models or trading.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, {
  max: 1, connection: { default_transaction_read_only: 'on', application_name: 'stage1-readonly-baseline' }
});
const directory = path.join(root, 'var/performance/stage1-baseline-2026-10-13');
const samples = Number(process.env.STOCKDEPTH_BASELINE_SAMPLES || 30);
if (!Number.isInteger(samples) || samples < 20 || samples > 100) throw Error('Use 20–100 samples');
const web = process.env.STOCKDEPTH_DIAGNOSTIC_URL || 'http://127.0.0.1:3000';
const api = process.env.STOCKDEPTH_API_URL || 'http://127.0.0.1:8008';
const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
function stats(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const percentile = p => Number(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)].toFixed(3));
  return { samples: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95),
    minMs: Number(sorted[0].toFixed(3)), maxMs: Number(sorted.at(-1).toFixed(3)) };
}
function procStat(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]), start: fields[19] };
}
function trackedProcesses() {
  const records = JSON.parse(fs.readFileSync(root + '/var/processes.json', 'utf8'));
  const parents = new Map();
  for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try { parents.set(Number(pid), procStat(pid)); } catch {}
  }
  const groups = {};
  for (const [name, record] of Object.entries(records)) {
    const ids = new Set([record.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, stat] of parents) if (ids.has(stat.parent) && !ids.has(id)) { ids.add(id); changed = true; }
    }
    groups[name] = [...ids].filter(id => parents.has(id)).map(id => ({ pid: id, start: parents.get(id).start }));
  }
  return groups;
}
function resourceSnapshot(groups) {
  const memory = fs.readFileSync('/proc/meminfo', 'utf8');
  const kb = key => Number(memory.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] || 0);
  const cpu = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number);
  const services = {};
  for (const [name, processes] of Object.entries(groups)) {
    let rssKb=0, ticks=0, readBytes=0, writeBytes=0, live=0, ioReadable=0;
    for (const process of processes) {
      try {
        const stat = procStat(process.pid);
        if (stat.start !== process.start) continue;
        live++; ticks += stat.ticks;
        rssKb += Number(fs.readFileSync(`/proc/${process.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] || 0);
        try {
          const io = fs.readFileSync(`/proc/${process.pid}/io`, 'utf8');
          readBytes += Number(io.match(/^read_bytes:\s+(\d+)/m)?.[1] || 0);
          writeBytes += Number(io.match(/^write_bytes:\s+(\d+)/m)?.[1] || 0); ioReadable++;
        } catch {}
      } catch {}
    }
    services[name] = { live, rssKb, ticks, readBytes, writeBytes, ioReadable };
  }
  return { at: new Date().toISOString(), monotonicMs: performance.now(), services,
    systemCpuTicks: cpu.reduce((a,b)=>a+b,0), systemIdleTicks: cpu[3]+cpu[4],
    memoryAvailableKb: kb('MemAvailable'), memoryTotalKb: kb('MemTotal'), swapUsedKb: kb('SwapTotal')-kb('SwapFree') };
}
async function currentWorkerProcScan() {
  const start=performance.now(); let scanned=0, runners=0;
  await fsp.readFile('/proc/meminfo','utf8');
  for (const pid of (await fsp.readdir('/proc')).filter(value=>/^\d+$/.test(value))) {
    try {
      const command=await fsp.readFile(`/proc/${pid}/cmdline`,'utf8'); scanned++;
      if (!command.split('\0').some(arg=>arg.endsWith('/analysis_runner.py'))) continue;
      await fsp.readFile(`/proc/${pid}/status`,'utf8'); runners++;
    } catch {}
  }
  return { elapsedMs: performance.now()-start, scanned, runners };
}
(async()=>{
  fs.mkdirSync(directory,{recursive:true});
  const groups=trackedProcesses(), resources=[];
  const samplingStarted=Date.now();
  resources.push(resourceSnapshot(groups));
  const timer=setInterval(()=>resources.push(resourceSnapshot(groups)),1000);
  try {
    const [user]=await sql`select u.id from users u where u.status='active' and u.deleted_at is null
      and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.hidden_at is null)
      order by (u.role='member') desc,u.id limit 1`;
    if (!user) throw Error('No read-only report fixture available');
    const [job]=await sql`select j.id,r.report_key from analysis_jobs j join analysis_reports r on r.job_id=j.id and r.user_id=j.user_id
      where j.user_id=${user.id} and j.hidden_at is null
      and (${Number(process.env.STOCKDEPTH_DIAGNOSTIC_JOB_ID || 0)} = 0 or j.id = ${Number(process.env.STOCKDEPTH_DIAGNOSTIC_JOB_ID || 0)})
      order by j.id desc,(r.report_key='progress') desc,r.id limit 1`;
    if (!job) throw Error('No read-only report fixture available');
    const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
    const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()})
      .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    const apiUser=process.env.STOCKDEPTH_API_USERNAME||process.env.STOCKDEPTH_WEB_USERNAME||'admin';
    const apiPassword=process.env.STOCKDEPTH_API_PASSWORD||process.env.STOCKDEPTH_WEB_PASSWORD||'';
    const routes=[
      ['web_page',web+'/dashboard/analysis',{cookie:'session='+token}],
      ['web_jobs',web+'/api/analysis/jobs',{cookie:'session='+token}],
      ['web_detail',web+`/api/analysis/jobs/${job.id}`,{cookie:'session='+token}],
      ['web_report',web+`/api/analysis/jobs/${job.id}?report=${encodeURIComponent(job.report_key)}`,{cookie:'session='+token}],
      ['python_api_options',api+'/api/options',{Authorization:'Basic '+Buffer.from(apiUser+':'+apiPassword).toString('base64')}]
    ];
    const rounds=[];
    for (let round=1;round<=2;round++) {
      const result=[];
      for(const [name,url,headers] of routes) {
        const elapsed=[],ttfb=[],bytes=[],statuses={};
        for(let i=0;i<=samples;i++) {
          const start=performance.now();
          const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000),redirect:'manual'});
          const first=performance.now()-start; const body=await response.arrayBuffer();
          if(i){elapsed.push(performance.now()-start);ttfb.push(first);bytes.push(body.byteLength);statuses[response.status]=(statuses[response.status]||0)+1;}
        }
        const metric={name,statuses,latency:stats(elapsed),ttfb:stats(ttfb),bytesMin:Math.min(...bytes),bytesMax:Math.max(...bytes)};
        result.push(metric); console.log(JSON.stringify({round,...metric}));
      }
      const db=[];for(let i=0;i<=100;i++){const start=performance.now();await sql`select 1`;if(i)db.push(performance.now()-start);}
      result.push({name:'database_rtt',latency:stats(db)});
      rounds.push({round,results:result});
    }
    const proc=[];for(let i=0;i<10;i++)proc.push(await currentWorkerProcScan());
    while(Date.now()-samplingStarted<20000)await new Promise(resolve=>setTimeout(resolve,250));
    resources.push(resourceSnapshot(groups));
    const first=resources[0],last=resources.at(-1),elapsed=(last.monotonicMs-first.monotonicMs)/1000;
    const serviceSummary={};
    for(const name of Object.keys(groups)){
      const a=first.services[name],b=last.services[name];
      serviceSummary[name]={pidCount:b.live,rssMinMb:Math.min(...resources.map(r=>r.services[name].rssKb))/1024,
        rssMaxMb:Math.max(...resources.map(r=>r.services[name].rssKb))/1024,
        cpuOneCorePercent:100*(b.ticks-a.ticks)/ticksPerSecond/elapsed,
        diskReadBytes:b.readBytes-a.readBytes,diskWriteBytes:b.writeBytes-a.writeBytes,
        ioReadable:b.ioReadable===b.live};
    }
    const cpuTotal=last.systemCpuTicks-first.systemCpuTicks;
    const [queue]=await sql`select count(*) filter(where status='running')::int as running,count(*) filter(where status='queued')::int as queued from analysis_jobs`;
    const digest=crypto.createHash('sha256').update(execFileSync('git',['diff','HEAD'],{cwd:root})).digest('hex');
    const artifact={at:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim(),
      head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),trackedDiffSha256:digest,
      mode:'sequential warmed authenticated read-only HTTP; no load test or model calls',samplesPerRoutePerRound:samples,
      fixture:{jobId:job.id,reportKey:job.report_key},
      rounds,procScan:{latency:stats(proc.map(p=>p.elapsedMs)),processesScannedMin:Math.min(...proc.map(p=>p.scanned)),processesScannedMax:Math.max(...proc.map(p=>p.scanned)),runners:proc.at(-1).runners},
      resources:{durationSeconds:elapsed,logicalCpus:os.cpus().length,systemCpuBusyPercent:100*(1-(last.systemIdleTicks-first.systemIdleTicks)/cpuTotal),
        memoryTotalMb:first.memoryTotalKb/1024,memoryAvailableMinMb:Math.min(...resources.map(r=>r.memoryAvailableKb))/1024,
        swapUsedMb:last.swapUsedKb/1024,services:serviceSummary},queueAtEnd:queue};
    fs.writeFileSync(directory+'/baseline.json',JSON.stringify(artifact,null,2));
    fs.writeFileSync(directory+'/resource-samples.json',JSON.stringify(resources,null,2));
    console.log(JSON.stringify({database:rounds.map(r=>r.results.at(-1)),procScan:artifact.procScan,resources:artifact.resources,queueAtEnd:queue}));
  }finally{clearInterval(timer);await sql.end();}
})().catch(error=>{console.error('Stage-one baseline failed:',error.code||error.name);process.exitCode=1;});
