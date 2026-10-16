// Isolated money/context/API and Worker-save tests. No dotenv, Workers or model calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');
const root=path.resolve(__dirname,'../..'),modules=root+'/apps/web/node_modules';
const name=process.env.ROUND5_TEST_DATABASE;assert.match(name||'',/^stockdepth_round5_backend_[a-z0-9_]+$/);
process.env.POSTGRES_URL=`postgres://ubuntu@127.0.0.1:55483/${name}`;
const postgres=require(modules+'/postgres'),sql=postgres(process.env.POSTGRES_URL,{max:2,onnotice(){}});
const {drizzle}=require(modules+'/drizzle-orm/postgres-js'),{migrate}=require(modules+'/drizzle-orm/postgres-js/migrator');
const auth=new AsyncLocalStorage();globalThis.__round5ContextAuth=auth;
const esbuildPackage=fs.readdirSync(root+'/node_modules/.pnpm').find(n=>n.startsWith('esbuild@0.25.'));
const esbuild=require(root+'/node_modules/.pnpm/'+esbuildPackage+'/node_modules/esbuild');
let api,checks=0;
function check(test,details){console.log(JSON.stringify({test,...details,pass:true}));checks++;}
async function fixture(cash=1000,quantity=1,cost=100,pnl=0){
 const [u]=await sql`insert into users(email,password_hash) values(${crypto.randomUUID()+'@isolated.invalid'},'test-only') returning id`;
 const [p]=await sql`insert into paper_portfolios(user_id,initial_cash_cents,cash_cents) values(${u.id},${cash},${cash}) returning id`;
 const [q]=await sql`insert into paper_positions(portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents) values(${p.id},${u.id},'TEST',${quantity},${cost},${cost},${pnl}) returning id`;
 return {u,p,q};
}
async function state(f){const [s]=await sql`select (select b.analysis_credits from billing_accounts b where b.user_id=u.id) as analysis_credits,(select count(*)::int from analysis_jobs where user_id=u.id) as jobs,(select count(*)::int from credit_transactions where user_id=u.id) as credits from users u where u.id=${f.u.id}`;return s;}
(async()=>{
 const [i]=await sql`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;
 assert.equal(i.name,name);assert.equal(i.host,'127.0.0.1/32');assert.equal(i.port,55483);
 assert.equal((await sql`select tablename from pg_tables where schemaname='public'`).length,0);
 await migrate(drizzle(sql),{migrationsFolder:root+'/apps/web/lib/db/migrations'});
 const out=root+`/apps/web/.round5-context-${process.pid}.cjs`;
 await esbuild.build({stdin:{contents:`export {POST as analyze} from './app/api/paper/analyze/route';
 export {buildPortfolioContext} from './lib/paper/portfolio-context';
 export {centsFromDecimal} from './lib/paper/amount';
 export {saveDecision} from '../workers/src/paper-trader-worker';
 import {db,client} from './lib/db/drizzle';export {client};
 import {applyTrade,lockPortfolio,lockPositions} from './lib/paper/trading';
 export const direct=async(userId,portfolioId,priceCents)=>db.transaction(async tx=>{
 const p=await lockPortfolio(tx,portfolioId,userId);const ps=await lockPositions(tx,p);
 return applyTrade(tx,p,ps[0],{ticker:'TEST',side:'sell',quantity:1,priceCents,note:null});});`,resolveDir:root+'/apps/web',loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',outfile:out,plugins:[{name:'no-env-no-models',setup(b){
 b.onLoad({filter:/lib\/db\/queries\.ts$/},()=>({contents:'export async function getUser(){return globalThis.__round5ContextAuth.getStore()}',loader:'ts'}));
 b.onLoad({filter:/lib\/analysis\/model-configs-server\.ts$/},()=>({contents:"export async function getDefaultModelConfig(){return {id:null,provider:'isolated',baseUrl:'http://isolated.invalid',modelName:'mock'}}",loader:'ts'}));
 b.onLoad({filter:/lib\/analysis\/pricing-server\.ts$/},()=>({contents:'export async function getDepthCreditCostFromDb(){return 1}',loader:'ts'}));
 b.onLoad({filter:/lib\/security\/model-key\.ts$/},()=>({contents:'export function readModelConfig(){throw new Error("model key access forbidden")}',loader:'ts'}));
 b.onLoad({filter:/lib\/db\/drizzle\.ts$/},a=>({contents:fs.readFileSync(a.path,'utf8').replace("dotenv.config({ path: '../../.env' });",''),loader:'ts',resolveDir:path.dirname(a.path)}));
 b.onLoad({filter:/paper-trader-worker\.ts$/},a=>{
 // Validate coordinator candidate without changing shared Worker/security hunks.
 let s=fs.readFileSync(a.path,'utf8').replace("import '../env';",'');
 s=s.slice(0,s.lastIndexOf('\nmain().catch('));
 s=s.replace("import { paperMarketContext }","import { centsFromDecimal } from '@/lib/paper/amount';\nimport { paperMarketContext }").replace('priceCents: Math.round(decision.suggested_price * 100),','priceCents: centsFromDecimal(String(decision.suggested_price)),');
 return {contents:s+'\nexport {saveDecision};',loader:'ts',resolveDir:path.dirname(a.path)};
 });
 b.onResolve({filter:/^dotenv$/},()=>({path:'forbidden',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default {config(){throw new Error("dotenv forbidden")}}',loader:'js'}));
 }}]});
 try{api=require(out);}finally{fs.unlinkSync(out);}
 const max=Number.MAX_SAFE_INTEGER;
 for(const [text,expected] of [['1.005',101],['0.145',15],['1e-7',0],['1e7',1000000000],['90071992547409.91',max]])assert.equal(api.centsFromDecimal(text),expected);
 assert.throws(()=>api.centsFromDecimal('90071992547409.92'),/safe integer/);
 assert.throws(()=>api.centsFromDecimal('1e308'),/safe integer/);
 check('exact decimal half-up scientific notation and MAX_SAFE',{boundary:max});
 const negative=await fixture(0,1,max,-1),positive=await fixture(0,1,0,0);
 const n=await api.direct(negative.u.id,negative.p.id,1),p=await api.direct(positive.u.id,positive.p.id,max);
 assert.equal(n.position.realizedPnlCents,-max);assert.equal(p.position.realizedPnlCents,max);
 check('exact signed cumulative PnL at both safe boundaries',{negative:n.position.realizedPnlCents,positive:p.position.realizedPnlCents});
 const f=await fixture(max-1000,1,999);
 const [watch]=await sql`insert into watchlist_items(user_id,ticker) values(${f.u.id},'TEST') returning id`;
 const req=()=>new Request('http://isolated.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({portfolioId:f.p.id,watchlistItemIds:[watch.id],depth:1})});
 const res=await auth.run(f.u,()=>api.analyze(req()));assert.equal(res.status,201);
 const [run]=await sql`select * from paper_analysis_runs where portfolio_id=${f.p.id}`;
 const context=JSON.parse(run.context);assert.equal(context.portfolio.totalValueCents,max-1);assert.equal(context.positions[0].marketValueCents,999);assert.equal(typeof context.portfolio.totalValueCents,'number');
 assert.deepEqual(await state(f),{analysis_credits:9,jobs:1,credits:1});
 check('analysis context exact safe monetary JSON before queued mock job',{totalValueCents:context.portfolio.totalValueCents});
 await sql`update paper_positions set quantity=2,last_price_cents=${max} where id=${f.q.id}`;
 const before=await state(f),overflow=await auth.run(f.u,()=>api.analyze(req()));assert.equal(overflow.status,422);assert.match((await overflow.json()).error,/safe integer/);assert.deepEqual(await state(f),before);
 check('analysis overflow422 without credit debit or queued job',{status:overflow.status,...before});
 const rawDecision={action:'hold',confidence:0,target_weight:0,quantity:0,suggested_price:1.005,reason:'isolated',risk_notes:''};
 const saved=await api.saveDecision({run:{id:run.id,portfolioId:run.portfolio_id,userId:run.user_id,analysisJobId:run.analysis_job_id,ticker:run.ticker},decision:rawDecision,raw:'{}',status:'skipped'});assert.equal(saved.priceCents,101);
 const workerFixture=await fixture();
 const [job]=await sql`insert into analysis_jobs(run_id,user_id,ticker,trade_date,analysts,status) values(${crypto.randomUUID()},${workerFixture.u.id},'TEST','2026-10-12','[]','failed') returning id`;
 const [workerRun]=await sql`insert into paper_analysis_runs(portfolio_id,user_id,analysis_job_id,ticker) values(${workerFixture.p.id},${workerFixture.u.id},${job.id},'TEST') returning *`;
 // Worker fields are camelCase; map only this synthetic run's identity fields.
 const input={id:workerRun.id,portfolioId:workerRun.portfolio_id,userId:workerRun.user_id,analysisJobId:workerRun.analysis_job_id,ticker:'TEST'};
 const huge=await api.saveDecision({run:input,decision:{...rawDecision,suggested_price:90071992547409.92},raw:'{}',status:'skipped'}).then(()=>false,e=>/safe integer/.test(e.message));assert(huge);
 const tiny=await api.saveDecision({run:input,decision:{...rawDecision,suggested_price:1e-7},raw:'{}',status:'skipped'});assert.equal(tiny.priceCents,0);
 check('Worker suggested cents candidate exact rounding unsafe rejection zero tiny suggestion',{rounded:saved.priceCents,tiny:tiny.priceCents,unsafeRejected:huge});
 console.log(JSON.stringify({completed:checks,isolation:'new-private-database-127.0.0.1:55483',workerPatchApplied:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(api)await api.client.end();await sql.end();});
