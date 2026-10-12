// Read-only local latency diagnostics. Never prints credentials or response contents.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, { max: 2 });
const base = process.env.STOCKDEPTH_DIAGNOSTIC_URL || 'http://127.0.0.1:3000';
const samples = Math.max(1, Math.min(10, Number(process.env.STOCKDEPTH_DIAGNOSTIC_SAMPLES || 3)));
const summary = values => ({ medianMs: Math.round([...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]), minMs: Math.round(Math.min(...values)), maxMs: Math.round(Math.max(...values)) });
(async () => {
 try {
  const dbTimes=[];
  for(let i=0;i<samples+1;i++){const start=performance.now();await sql`select 1`;if(i)dbTimes.push(performance.now()-start);}
  console.log(JSON.stringify({name:'database_network_roundtrip',...summary(dbTimes)}));
  const [user]=await sql`select u.id from users u where u.status='active' and u.deleted_at is null and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.hidden_at is null) order by (u.role='member') desc,u.id limit 1`;
  if(!user)throw Error('No active user with visible jobs');
  const [job]=await sql`select id from analysis_jobs where user_id=${user.id} and hidden_at is null
    and (${Number(process.env.STOCKDEPTH_DIAGNOSTIC_JOB_ID || 0)} = 0 or id = ${Number(process.env.STOCKDEPTH_DIAGNOSTIC_JOB_ID || 0)})
    and exists(select 1 from analysis_reports r where r.job_id=analysis_jobs.id) order by id desc limit 1`;
  if(!job)throw Error('No matching report-bearing job');
  const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
  const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  for(const route of ['/api/paper']){
   const times=[],ttfb=[];let bytes=0,status=0,timing=null;
   for(let i=0;i<samples+1;i++){
    const start=performance.now();const res=await fetch(base+route,{headers:{cookie:'session='+token},signal:AbortSignal.timeout(90000)});
    const first=performance.now()-start;const body=await res.arrayBuffer();
    if(i){times.push(performance.now()-start);ttfb.push(first);}
    bytes=body.byteLength;status=res.status;timing=res.headers.get('server-timing');
   }
   console.log(JSON.stringify({name:route,status,bytes,ttfb:summary(ttfb),...summary(times),serverTiming:timing}));
  }
  const [counts]=await sql`select (select count(*) from paper_portfolios where user_id=${user.id} and status='active')::int as portfolios,(select count(*) from watchlist_items where user_id=${user.id} and is_active)::int as watchlist,(select count(*) from paper_analysis_runs where user_id=${user.id})::int as runs`;
  console.log(JSON.stringify({name:'paper_query_counts',...counts,sourceSqlCountWithPortfolio:7,serialReadWavesAfterAuth:process.argv.includes('--current') ? 2 : 4}));
 } finally { await sql.end(); }
})().catch(error=>{console.error('Paper diagnostic failed:',error.code||error.name);process.exitCode=1;});
