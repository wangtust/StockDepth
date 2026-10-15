// Read-only integration checks against the running local service and database.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'../..'),modules=root+'/apps/web/node_modules';
require(modules+'/dotenv').config({path:root+'/.env',quiet:true});
const postgres=require(modules+'/postgres');
(async()=>{
 const {SignJWT}=await import(modules+'/jose/dist/webapi/index.js');
 const sql=postgres(process.env.POSTGRES_URL,{max:1});
 const base='http://127.0.0.1:3000';
 try {
  assert.equal((await fetch(base+'/api/market/instruments/1/decisions')).status,401);
  const users=await sql`select id from users where deleted_at is null and status='active' order by id limit 2`;
  assert.ok(users.length,'active account required for integration check');
  for(const user of users) {
   const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+60000).toISOString()}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
   const headers={cookie:`session=${token}`};
   assert.equal((await fetch(base+'/api/market/instruments/1/decisions?from=2026-02-30',{headers})).status,400);
   assert.equal((await fetch(base+'/api/market/instruments/1/decisions?basis=bad',{headers})).status,400);
   assert.equal((await fetch(base+'/api/market/instruments/2147483647/decisions',{headers})).status,404);
   const instruments=await sql`select id from instruments order by id`;
   for(const instrument of instruments) {
    const response=await fetch(`${base}/api/market/instruments/${instrument.id}/decisions?from=2020-01-01&to=2026-12-31`,{headers});
    assert.equal(response.status,200);
    const data=await response.json();
    const expected=await sql`select id from analysis_jobs where user_id=${user.id} and instrument_id=${instrument.id} and status='complete' and hidden_at is null and trade_date between '2020-01-01' and '2026-12-31' order by trade_date,id`;
    assert.deepEqual(data.decisions.map(d=>d.jobId),expected.map(j=>j.id),'only owned completed visible jobs returned');
    assert.equal(new Set(data.prices.map(p=>p.date)).size,data.prices.length,'unique price per session');
    assert.equal(data.adjusted,false);
   }
   const generated=await fetch(base+'/api/market/instruments/1/decisions?from=2020-01-01&to=2026-12-31&basis=generated',{headers});
   assert.equal(generated.status,200);
   const result=await generated.json();
   for(const d of result.decisions) assert.equal(d.date,new Intl.DateTimeFormat('en-CA',{timeZone:result.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.completedAt)));
  }
  console.log(`PASS: authentication, invalid dates/basis, missing instrument, ownership and visibility across ${users.length} accounts, single price series, generation dates in market timezone.`);
 } finally {await sql.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
