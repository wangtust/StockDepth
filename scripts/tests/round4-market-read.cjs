// Deployed HTTP reads only. Runtime environment must be supplied without printing secrets.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const db=require(root+'/apps/web/node_modules/postgres')(process.env.POSTGRES_URL,{max:1,onnotice(){}});
(async()=>{const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
 await db.begin('read only',async tx=>{
 const users=await tx`select id from users where role='member' and status='active' and deleted_at is null order by id limit 2`;assert.equal(users.length,2);
 const base='http://127.0.0.1:3000';assert.equal((await fetch(base+'/api/market/instruments')).status,401);
 const headers=await Promise.all(users.map(async u=>({cookie:'session='+await new SignJWT({user:{id:u.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET))})));
 const lists=await Promise.all(headers.map(async h=>{const r=await fetch(base+'/api/market/instruments?limit=100',{headers:h});assert.equal(r.status,200);return r.json();}));assert.deepEqual(lists[0],lists[1]);assert(lists[0].instruments.length>0);
 for(const item of lists[0].instruments){assert.deepEqual(Object.keys(item).sort(),['id','symbol','exchange','name','currency','timezone','status'].sort());}
 const id=lists[0].instruments[0].id;assert.equal((await fetch(base+'/api/market/instruments/'+id)).status,401);
 const details=await Promise.all(headers.map(async h=>{const r=await fetch(base+'/api/market/instruments/'+id+'?limit=30',{headers:h});assert.equal(r.status,200);return r.json();}));
 assert.deepEqual(details[0].instrument,details[1].instrument);assert(details[0].dailyPrices.length<=30);
 for(const detail of details){assert(!JSON.stringify(detail).match(/apiKey|password|owner|errorSummary|vendorSymbol/));if(detail.latestQuote)assert.deepEqual(Object.keys(detail.latestQuote).sort(),['id','price','currency','quotedAt','fetchedAt','source','priceType','freshness'].sort());}
 assert.equal((await fetch(base+'/api/market/instruments?limit=101',{headers:headers[0]})).status,400);
 assert.equal((await fetch(base+'/dashboard/stocks',{headers:headers[0]})).status,200);
 assert.equal((await fetch(base+'/dashboard/stocks/'+id,{headers:headers[0]})).status,200);
 console.log('PASS: deployed anonymous denial, real member shared list/detail, bounded redacted DTO and authenticated stock pages; HTTP GET only, database read-only transaction');
 });
})().catch(()=>{console.error('deployed_market_read_failed');process.exitCode=1;}).finally(()=>db.end());
