// Actual signed sessions against an isolated built web server. All writes are private.
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),name=process.env.ROUND4_TEST_DATABASE;
assert.match(name||'',/^stockdepth_round4_backend_[a-z0-9_]+$/);
const db=require(root+'/apps/web/node_modules/postgres')('postgres://ubuntu@127.0.0.1:55483/'+name,{max:1,onnotice(){}});
const base='http://127.0.0.1:3304';
(async()=>{
 const [identity]=await db`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;
 assert.equal(identity.name,name);assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55483);
 const symbol='HTTP'+Date.now();const [marker]=await db`insert into instruments(symbol,exchange,sync_enabled) values(${symbol},'UNRESOLVED',false) returning id`;
 const members=[];for(let n=0;n<2;n++)members.push((await db`insert into users(email,password_hash) values(${symbol+n+'@isolated.invalid'},'test-only') returning id`)[0]);
 const [admin]=await db`insert into users(email,password_hash,role) values(${symbol+'admin@isolated.invalid'},'test-only','admin') returning id`;
 const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
 async function headers(user){const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode('round4-private-http-secret'));return {cookie:'session='+token,'content-type':'application/json'};}
 const h=await Promise.all(members.map(headers));
 assert.equal((await fetch(base+'/api/market/instruments')).status,401);
 assert.equal((await fetch(base+'/api/market/instruments/'+marker.id)).status,401);
 for(const hd of h){const r=await fetch(base+'/api/market/instruments?q='+symbol,{headers:hd});assert.equal(r.status,200);assert.equal((await r.json()).instruments[0].symbol,symbol);}
 // Canary above proves this server is reading the selected private database before writes.
 const ticker=symbol+'Q';const replies=await Promise.all(h.map(hd=>fetch(base+'/api/paper/watchlist',{method:'POST',headers:hd,body:JSON.stringify({ticker})})));
 const items=await Promise.all(replies.map(async r=>{assert.equal(r.status,201);return (await r.json()).item;}));
 assert.equal(items[0].instrumentId,items[1].instrumentId);assert(items[0].instrumentId);
 assert.equal((await db`select * from market_sync_state where instrument_id=${items[0].instrumentId}`).length,3);
 for(let n=0;n<2;n++){
   const r=await fetch(base+'/api/paper',{headers:h[n]});assert.equal(r.status,200);const body=await r.json();assert.equal(body.watchlist.length,1);assert.equal(body.watchlist[0].userId,members[n].id);
   const [p]=await db`insert into paper_portfolios(user_id,initial_cash_cents,cash_cents) values(${members[n].id},10000,10000) returning id`;
   const key=crypto.randomUUID(),input={portfolioId:p.id,ticker,side:'buy',quantity:1,price:1.23};
   const request=()=>fetch(base+'/api/paper/trades',{method:'POST',headers:{...h[n],'Idempotency-Key':key},body:JSON.stringify(input)});
   const first=await request();assert.equal(first.status,201);const original=await first.json();const replay=await request();assert.equal(replay.status,201);assert.deepEqual(await replay.json(),original);
   assert.equal(original.trade.instrumentId,items[n].instrumentId);
   const denied=await fetch(base+'/api/paper/trades',{method:'POST',headers:h[1-n],body:JSON.stringify(input)});assert.equal(denied.status,404);
 }
 const [model]=await db`insert into llm_model_configs(name,provider,base_url,api_key,model_name,is_default) values('private-no-call','mock','http://127.0.0.1:1','test-only','mock',true) returning id`;
 const analysisTicker=symbol+'A';const analysis=await fetch(base+'/api/analysis/jobs',{method:'POST',headers:h[0],body:JSON.stringify({ticker:analysisTicker,depth:1,modelConfigId:model.id})});
 assert.equal(analysis.status,201);const job=(await analysis.json()).job;assert(job.instrumentId);
 assert.equal((await db`select * from market_sync_state where instrument_id=${job.instrumentId}`).length,3);
 // This isolated DB has no Worker; queued analysis is changed to failed without model invocation.
 await db`update analysis_jobs set status='failed' where id=${job.id}`;
 const [portfolio]=await db`select id from paper_portfolios where user_id=${members[1].id}`;
 const paper=await fetch(base+'/api/paper/analyze',{method:'POST',headers:h[1],body:JSON.stringify({portfolioId:portfolio.id,watchlistItemIds:[items[1].id],depth:1})});assert.equal(paper.status,201);
 const jobs=await db`select instrument_id from analysis_jobs where user_id=${members[1].id}`;assert.equal(jobs.length,1);assert.equal(jobs[0].instrument_id,items[1].instrumentId);
 await db`update analysis_jobs set status='failed' where user_id=${members[1].id}`;
 const route=base+'/api/market/instruments/'+items[0].instrumentId+'/sync';
 assert.equal((await fetch(route,{method:'PATCH',headers:h[0],body:JSON.stringify({enabled:false})})).status,403);
 assert.equal((await fetch(route,{method:'PATCH',headers:await headers(admin),body:JSON.stringify({enabled:false})})).status,200);
 const before=await db`select * from market_sync_state order by id`;
 const bodies=await Promise.all(h.map(async hd=>(await fetch(base+'/api/market/instruments/'+items[0].instrumentId,{headers:hd})).json()));assert.deepEqual(bodies[0],bodies[1]);
 assert.deepEqual(await db`select * from market_sync_state order by id`,before);
 assert(!JSON.stringify(bodies).match(/apiKey|password|owner|errorSummary|vendorSymbol/));
 await db`update users set status='inactive' where id=${members[0].id}`;
 assert.equal((await fetch(base+'/api/market/instruments',{headers:h[0]})).status,401);
 console.log('PASS: real signed sessions, anonymous/inactive denial, shared DTO, own portfolio isolation, concurrent first additions, local queue, manual replay, foreign portfolio denial, administrator pause, GET leaves sync states unchanged');
})().catch(e=>{console.error('Private HTTP assertion failed',e.message);process.exitCode=1;}).finally(()=>db.end());
