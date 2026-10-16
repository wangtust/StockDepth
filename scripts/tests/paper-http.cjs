// Read-only deployed ownership/money regression; never queues analysis or trades.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname,'../..');
require(root+'/apps/web/node_modules/dotenv').config({path:root+'/.env'});
const db = require(root+'/apps/web/node_modules/postgres')(process.env.POSTGRES_URL,{max:1});
(async()=>{
 try{
  const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
  const users=await db`select id,(select b.analysis_credits from billing_accounts b where b.user_id=users.id) as analysis_credits from users where role='member' and status='active' and deleted_at is null order by id limit 2`;
  assert.equal(users.length,2);
  assert.equal((await fetch('http://127.0.0.1:3000/api/paper')).status,401);
  for(const user of users){
   const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
   const res=await fetch('http://127.0.0.1:3000/api/paper',{headers:{cookie:'session='+token}});
   assert.equal(res.status,200);const body=await res.json();
   assert.equal(body.credits,user.analysis_credits);assert(body.watchlist.every(w=>w.userId===user.id));
   assert(!JSON.stringify(body).includes('apiKey'));assert(!JSON.stringify(body).includes('pricingSnapshot'));
   if(body.portfolio){
    assert.equal(body.portfolio.userId,user.id);
    const [p]=await db`select cash_cents,initial_cash_cents from paper_portfolios where id=${body.portfolio.id} and user_id=${user.id}`;
    assert(p);assert.equal(body.portfolio.cashCents,p.cash_cents);assert.equal(body.portfolio.initialCashCents,p.initial_cash_cents);
    for(const row of [...body.positions,...body.trades]){assert.equal(row.userId,user.id);assert.equal(row.portfolioId,body.portfolio.id);}
    const trades=await db`select id,price_cents,gross_amount_cents,fee_cents,realized_pnl_cents from paper_trades where portfolio_id=${body.portfolio.id}`;
    for(const t of body.trades){const saved=trades.find(x=>x.id===t.id);assert(saved);for(const [key,col] of [['priceCents','price_cents'],['grossAmountCents','gross_amount_cents'],['feeCents','fee_cents'],['realizedPnlCents','realized_pnl_cents']])assert.equal(t[key],saved[col]);}
    const [activity]=await db`select exists(select 1 from paper_analysis_runs r join analysis_jobs j on j.id=r.analysis_job_id where r.portfolio_id=${body.portfolio.id} and j.status in ('queued','running')) as active`;
    assert.equal(body.hasActiveAnalysisRuns,activity.active);
    assert(body.analysisRuns.length<=30);assert(body.trades.length<=50);
   }else {assert.equal(body.hasActiveAnalysisRuns,false);assert.equal(body.positions.length,0);assert.equal(body.trades.length,0);assert.equal(body.analysisRuns.length,0);}
  }
  console.log('PASS: anonymous 401, two-user portfolio/watchlist/position/trade isolation, credits/cash/trade cents, public model fields, full-history activity');
 }finally{await db.end();}
})().catch(e=>{console.error('Paper HTTP regression failed:',e.name,e.code||'assertion');process.exitCode=1;});
