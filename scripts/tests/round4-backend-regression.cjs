// Private PostgreSQL cluster only. Never reads .env; actual API/executor, auth alone mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '../..');
const modules = root + '/apps/web/node_modules';
const baseline = process.argv.includes('--baseline');
const baselineCommit = '91d9b82e4e7abe6913fc5240d5184631317f95d6';
const replayOnly = process.argv.includes('--replay-only');
const processTradeOnly = process.argv.includes('--process-trade-only');
const dbName = process.env.ROUND3_TEST_DATABASE;
assert.match(dbName || '', /^stockdepth_round4_backend_[a-z0-9_]+$/);
// Hard-coded loopback and private port; no user-supplied URL and no production fallback.
process.env.POSTGRES_URL = `postgres://ubuntu@127.0.0.1:55483/${dbName}`;
process.env.STOCKDEPTH_DB_POOL_SIZE = '20';
const postgres = require(modules + '/postgres');
const { drizzle } = require(modules + '/drizzle-orm/postgres-js');
const { migrate } = require(modules + '/drizzle-orm/postgres-js/migrator');
const sql = postgres(process.env.POSTGRES_URL, { max: 20 });
const esbuildPackage = fs.readdirSync(root + '/node_modules/.pnpm').find(n => n.startsWith('esbuild@0.25.'));
const esbuild = require(root + '/node_modules/.pnpm/' + esbuildPackage + '/node_modules/esbuild');
const auth = new AsyncLocalStorage();
globalThis.__paperTestAuth = auth;
let api;
let checks = 0;
async function check(name, operation) {
  const outcome = await operation();
  console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'fixed', test: name, ...outcome }));
  checks++;
  if (!baseline) assert.equal(outcome.pass, true, name);
}
async function fixture({ cash = 1000, quantity = 0, action = 'buy', user } = {}) {
  if (!user) [user] = await sql`insert into users(email,password_hash) values(${crypto.randomUUID()+'@isolated.invalid'},'test-only') returning *`;
  const [portfolio] = await sql`insert into paper_portfolios(user_id,initial_cash_cents,cash_cents) values(${user.id},${cash},${cash}) returning *`;
  const [position] = await sql`insert into paper_positions(portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents) values(${portfolio.id},${user.id},'TEST',${quantity},100,100) returning *`;
  const [job] = await sql`insert into analysis_jobs(run_id,user_id,ticker,trade_date,analysts,status) values(${crypto.randomUUID()},${user.id},'TEST','2026-10-12','[]','failed') returning id`;
  const [run] = await sql`insert into paper_analysis_runs(portfolio_id,user_id,analysis_job_id,ticker) values(${portfolio.id},${user.id},${job.id},'TEST') returning id`;
  const [decision] = await sql`insert into paper_trade_decisions(portfolio_id,user_id,paper_analysis_run_id,analysis_job_id,ticker,action,target_weight_bps,quantity,price_cents) values(${portfolio.id},${user.id},${run.id},${job.id},'TEST',${action},${action==='buy'?10000:0},10,100) returning *`;
  // Drizzle uses camelCase. Fetch via the bundled application's db for worker-compatible input.
  return { user, portfolio: await api.readPortfolio(portfolio.id), positions: await api.readPositions(portfolio.id), decision: await api.readDecision(decision.id) };
}
async function manual(f, extra = {}, key, user = f.user) {
  const body = { portfolioId: f.portfolio.id, ticker: 'TEST', side: 'buy', quantity: 7, price: 1, ...extra };
  const req = new Request('http://isolated.test/api/paper/trades', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
  const res = await auth.run(user, () => api.POST(req));
  return { status: res.status, body: await res.json() };
}
async function ai(f, extra = {}) { return api.executePaperDecision({ ...f, maxPositionBps: 10000, maxTradeBps: 10000, ...extra }); }
async function state(f) {
  const [p] = await sql`select cash_cents from paper_portfolios where id=${f.portfolio.id}`;
  const [q] = await sql`select quantity from paper_positions where portfolio_id=${f.portfolio.id}`;
  const [t] = await sql`select count(*)::int as count, coalesce(sum(quantity) filter(where side='buy'),0)::int as buys, coalesce(sum(quantity) filter(where side='sell'),0)::int as sells from paper_trades where portfolio_id=${f.portfolio.id}`;
  return { cash: p.cash_cents, quantity: q.quantity, trades: t.count, buys: t.buys, sells: t.sells };
}
(async () => {
  const [identity] = await sql`select current_database() as name, inet_server_addr()::text as host, inet_server_port() as port`;
  assert.equal(identity.name, dbName); assert.equal(identity.host, '127.0.0.1/32'); assert.equal(identity.port, 55483);
  if (!replayOnly && !processTradeOnly) {
  const tables = await sql`select tablename from pg_tables where schemaname='public'`;
  assert.equal(tables.length, 0, 'Requires a NEW empty isolated database');
  let migrationsFolder=root+'/apps/web/lib/db/migrations';
  const journal=JSON.parse(fs.readFileSync(migrationsFolder+'/meta/_journal.json'));
  if(baseline) {
    // Freeze both source and migration history to the measured pre-round3 commit.
    migrationsFolder=fs.mkdtempSync(root+'/var/codex-team-round4/backend-old-migrations-');
    fs.mkdirSync(migrationsFolder+'/meta');
    const oldJournal=JSON.parse(execFileSync('git',['show',baselineCommit+':apps/web/lib/db/migrations/meta/_journal.json'],{cwd:root,encoding:'utf8'}));
    fs.writeFileSync(migrationsFolder+'/meta/_journal.json',JSON.stringify(oldJournal));
    for(const entry of oldJournal.entries) fs.writeFileSync(migrationsFolder+'/'+entry.tag+'.sql',execFileSync('git',['show',baselineCommit+':apps/web/lib/db/migrations/'+entry.tag+'.sql'],{cwd:root}));
  }
  try {await migrate(drizzle(sql), { migrationsFolder });}
  finally {if(baseline) fs.rmSync(migrationsFolder,{recursive:true});}
  const [migrationCount] = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(migrationCount.count, baseline ? 25 : journal.entries.length);
  console.log(JSON.stringify({ isolation: 'loopback-private-port-new-empty-database', migrations: migrationCount.count }));
  }
  const out = root + `/apps/web/.round4-regression-test-${process.pid}.cjs`;
  await esbuild.build({ stdin: { contents: `export { POST } from './app/api/paper/trades/route';
    export { POST as portfolioPOST } from './app/api/paper/portfolio/route';
    export { POST as decisionPOST } from './app/api/paper/decisions/[id]/execute/route';
    export { executePaperDecision } from './lib/paper/execution';
    import {db,client} from './lib/db/drizzle'; import {eq} from 'drizzle-orm'; import {paperPortfolios,paperPositions,paperTradeDecisions} from './lib/db/schema';
    export {client};
    export const readPortfolio=async(id)=>(await db.select().from(paperPortfolios).where(eq(paperPortfolios.id,id)))[0];
    export const readPositions=async(id)=>db.select().from(paperPositions).where(eq(paperPositions.portfolioId,id));
    export const readDecision=async(id)=>(await db.select().from(paperTradeDecisions).where(eq(paperTradeDecisions.id,id)))[0];`, resolveDir: root+'/apps/web', loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: out,
    plugins: [{ name: 'isolate-auth-and-env', setup(build) {
      build.onLoad({filter:/lib\/market\/(?:service|policy)\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replaceAll('now=new Date()',"now=new Date('2026-10-12T15:00:00Z')"),loader:'ts',resolveDir:path.dirname(args.path)}));
      build.onLoad({ filter: /lib\/db\/queries\.ts$/ }, () => ({ contents: 'export async function getUser(){return globalThis.__paperTestAuth.getStore() ?? null}', loader: 'ts' }));
      if (baseline) build.onLoad({filter: /(?:route|execution|schema)\.ts$/}, args => {
        const relative=path.relative(root,args.path);
        if(!['apps/web/app/api/paper/trades/route.ts','apps/web/app/api/paper/decisions/[id]/execute/route.ts','apps/web/lib/paper/execution.ts','apps/web/lib/db/schema.ts'].includes(relative)) return;
        return {contents:execFileSync('git',['show',baselineCommit+':'+relative],{cwd:root,encoding:'utf8'}),loader:'ts',resolveDir:path.dirname(args.path)};
      });
      build.onResolve({filter: /^dotenv$/}, () => ({path:'disabled-dotenv',namespace:'test'}));
      build.onLoad({filter: /.*/,namespace:'test'}, () => ({contents:'export default {config(){throw new Error("dotenv forbidden in isolated tests")}}',loader:'js'}));
      build.onLoad({ filter: /lib\/db\/drizzle\.ts$/ }, args => ({ contents: fs.readFileSync(args.path,'utf8').replace("dotenv.config({ path: '../../.env' });", ''), loader: 'ts', resolveDir: path.dirname(args.path) }));
    }}] });
  try { api = require(out); } finally { fs.unlinkSync(out); }
  if (!processTradeOnly && !replayOnly && !baseline) {
    const [i]=await sql`insert into instruments(symbol,exchange,currency,timezone,status,verified_at) values('TEST','XNAS','USD','America/New_York','verified',now()) returning id`;
    await sql`insert into instrument_sources(instrument_id,vendor,vendor_symbol,status,verified_at) values(${i.id},'yahoo','TEST','verified',now())`;
    await sql`insert into price_snapshots(instrument_id,price,currency,quoted_at,source,price_type,session) values(${i.id},'1.00000000','USD','2026-10-12T15:00:00Z','yahoo','regular_unadjusted','regular')`;
  }
  if (processTradeOnly) {
    const input=JSON.parse(fs.readFileSync(process.env.ROUND3_PROCESS_CASE,'utf8'));
    const result=await manual(input.fixture,{quantity:1},input.key);
    console.log(JSON.stringify(result)); return;
  }
  if (replayOnly) {
    const [saved]=await sql`select * from paper_trade_requests order by id limit 1`;
    assert(saved); const data=JSON.parse(saved.request); if(data.note===null) delete data.note;
    const [user]=await sql`select id from users where id=${saved.user_id}`;
    const f={user,portfolio:{id:saved.portfolio_id}};
    const before=await state(f); const r=await manual(f,data,saved.key); const after=await state(f);
    assert.equal(r.status,201); assert.deepEqual(r.body,saved.result); assert.deepEqual(after,before);
    console.log(JSON.stringify({test:'persisted key replay in a new process',pass:true,trades:after.trades}));
    return;
  }
  // Delay position writes to make stale reads reproducible; identical fixture in before/after runs.
  await sql`create function round3_delay() returns trigger language plpgsql as $$ begin perform pg_sleep(0.08); return NEW; end $$`;
  await sql`create trigger round3_delay before update on paper_positions for each row execute function round3_delay()`;
  await check('concurrent buys cannot overspend', async () => {
    const f = await fixture(); const r = await Promise.all(Array.from({length:8},()=>manual(f))); const s=await state(f);
    return {...s, successes:r.filter(x=>x.status===201).length, pass:s.cash>=0 && s.trades===1 && s.quantity===7};
  });
  await check('concurrent sells cannot oversell', async () => {
    const f=await fixture({quantity:10}); const r=await Promise.all(Array.from({length:8},()=>manual(f,{side:'sell'}))); const s=await state(f);
    return {...s, successes:r.filter(x=>x.status===201).length, pass:s.quantity===3 && s.trades===1 && s.cash===1700};
  });
  await check('concurrent affordable buys retain every update', async () => {
    const f=await fixture({cash:10000}); const r=await Promise.all(Array.from({length:8},()=>manual(f,{quantity:1}))); const s=await state(f);
    return {...s, pass:r.every(x=>x.status===201) && s.cash===9200 && s.quantity===8 && s.trades===8};
  });
  await check('same AI decision concurrency and stale replay', async () => {
    const f=await fixture(); await Promise.all(Array.from({length:8},()=>ai(f))); await ai(f); const s=await state(f);
    return {...s, pass:s.trades===1 && s.cash===0 && s.quantity===10};
  });
  await check('mixed AI/manual buy competition', async () => {
    const f=await fixture(); await Promise.allSettled([ai(f),...Array.from({length:7},()=>manual(f))]); const s=await state(f);
    return {...s, pass:s.cash>=0 && s.quantity===s.buys && s.cash===1000-s.buys*100};
  });
  await check('mixed AI/manual sell competition', async () => {
    const f=await fixture({quantity:10,action:'sell'}); await Promise.allSettled([ai(f),...Array.from({length:7},()=>manual(f,{side:'sell'}))]); const s=await state(f);
    return {...s, pass:s.quantity>=0 && s.quantity===10-s.sells && s.cash===1000+s.sells*100};
  });
  await check('idempotency concurrent response replay and conflict', async () => {
    const f=await fixture({cash:10000}); const key=crypto.randomUUID(); const rs=await Promise.all(Array.from({length:8},()=>manual(f,{quantity:1},key)));
    const replay=await manual(f,{quantity:1},key); const conflict=await manual(f,{quantity:2},key); const s=await state(f);
    return {...s, conflict:conflict.status, pass:s.trades===1 && rs.every(r=>r.status===201 && isDeepStrictEqual(r.body,replay.body)) && conflict.status===409};
  });
  await check('new keys and no-key clients allow equal separate trades', async () => {
    const f=await fixture({cash:10000}); for(const key of [crypto.randomUUID(),crypto.randomUUID(),undefined,undefined]) assert.equal((await manual(f,{quantity:1},key)).status,201);
    const s=await state(f); return {...s,pass:s.trades===4 && s.quantity===4};
  });
  await check('key isolated by user and portfolio', async () => {
    const f=await fixture({cash:10000}), g=await fixture({cash:10000,user:f.user}), h=await fixture({cash:10000}); const key=crypto.randomUUID();
    const rs=await Promise.all([manual(f,{quantity:1},key),manual(g,{quantity:1},key),manual(h,{quantity:1},key)]);
    return {pass:rs.every(r=>r.status===201) && (await state(f)).trades===1 && (await state(g)).trades===1 && (await state(h)).trades===1};
  });
  await check('permission and active status rechecked with stale snapshots', async () => {
    const f=await fixture(); const denied=await manual(f,{},undefined,{id:f.user.id+99999}); const anon=await manual(f,{},undefined,null);
    const decisionDenied=await auth.run({id:f.user.id+99999},()=>api.decisionPOST(new Request('http://isolated.test'),{params:Promise.resolve({id:String(f.decision.id)})}));
    await sql`update paper_portfolios set status='inactive' where id=${f.portfolio.id}`;
    const inactive=await manual(f); const a=await Promise.allSettled([ai(f)]); const s=await state(f);
    return {...s, denied:denied.status, anonymous:anon.status, decisionDenied:decisionDenied.status, inactive:inactive.status, ai:a[0].status, pass:denied.status>=400 && anon.status===401 && decisionDenied.status===404 && inactive.status>=400 && s.trades===0};
  });
  await check('unsafe product, zero rounded price, invalid UUID and rollback', async () => {
    const f=await fixture({cash:2147483647}); const before=await state(f);
    const rs=await Promise.all([manual(f,{quantity:10000000,price:10000000}),manual(f,{quantity:1,price:0.001}),manual(f,{quantity:1},'invalid-key'),manual(f,{quantity:Number.MAX_SAFE_INTEGER+1})]);
    const after=await state(f); return {statuses:rs.map(r=>r.status),...after,pass:rs.every(r=>r.status===400) && JSON.stringify(before)===JSON.stringify(after)};
  });
  await check('database failure rolls back cash, position, decision and key', async () => {
    const f=await fixture(); const key=crypto.randomUUID();
    await sql`create function round3_fail() returns trigger language plpgsql as $$ begin raise exception 'isolated forced failure'; end $$`;
    await sql`create trigger round3_fail before insert on paper_trades for each row execute function round3_fail()`;
    const r=await manual(f,{quantity:1},key); await Promise.allSettled([ai(f)]); const s=await state(f); const d=await api.readDecision(f.decision.id);
    await sql`drop trigger round3_fail on paper_trades`; await sql`drop function round3_fail()`;
    const retry=await manual(f,{quantity:1},key);
    return {...s, retry:retry.status, pass:r.status>=400 && s.cash===1000 && s.quantity===0 && s.trades===0 && d.status==='proposed' && retry.status===201 && (await state(f)).trades===1};
  });
  if(!baseline) {
    await check('result persistence failure rolls back the trade atomically', async () => {
      const f=await fixture(); const key=crypto.randomUUID();
      await sql`create function round3_result_fail() returns trigger language plpgsql as $$ begin raise exception 'isolated result persistence failure'; end $$`;
      await sql`create trigger round3_result_fail before insert on paper_trade_requests for each row execute function round3_result_fail()`;
      const failed=await manual(f,{quantity:1},key); const st=await state(f);
      const [records]=await sql`select count(*)::int as count from paper_trade_requests where portfolio_id=${f.portfolio.id}`;
      await sql`drop trigger round3_result_fail on paper_trade_requests`; await sql`drop function round3_result_fail()`;
      const retry=await manual(f,{quantity:1},key); const after=await state(f);
      return {...st,records:records.count,retry:retry.status,pass:failed.status===400 && st.cash===1000 && st.quantity===0 && st.trades===0 && records.count===0 && retry.status===201 && after.trades===1 && after.cash===900};
    });
    await check('concurrent creation of previously absent position', async () => {
      const f=await fixture({cash:10000}); await sql`delete from paper_positions where portfolio_id=${f.portfolio.id}`;
      const rs=await Promise.all(Array.from({length:8},()=>manual(f,{quantity:1}))); const s=await state(f);
      return {...s,pass:rs.every(r=>r.status===201) && s.quantity===8 && s.trades===8 && s.cash===9200};
    });
    await check('current decision state and ownership override stale caller hints', async () => {
      const f=await fixture(); await sql`update paper_trade_decisions set status='failed' where id=${f.decision.id}`;
      const failed=await Promise.allSettled([ai(f)]);
      await sql`update paper_trade_decisions set status='proposed' where id=${f.decision.id}`;
      const g=await fixture(); const wrong=await Promise.allSettled([ai(f,{portfolio:g.portfolio})]);
      await sql`update users set status='inactive' where id=${f.user.id}`;
      const inactive=await manual(f,{quantity:1}); const disabled=await Promise.allSettled([ai(f)]);
      const st=await state(f);
      return {...st,pass:failed[0].status==='rejected' && wrong[0].status==='rejected' && inactive.status===403 && disabled[0].status==='rejected' && st.trades===0};
    });
    await check('blocked execution rechecks permission and active state after lock wait', async () => {
      async function waitForLocks(expected) {
        for(let i=0;i<150;i++) {
          const [r]=await sql`select count(*)::int as count from pg_stat_activity where datname=${dbName} and wait_event_type='Lock'`;
          if(r.count>=expected) return;
          await new Promise(r=>setTimeout(r,20));
        }
        throw new Error('Execution did not wait for held transaction lock');
      }
      for(const target of ['user','portfolio','decision']) {
        const f=await fixture(); let calls;
        await sql.begin(async tx=>{
          if(target==='user') await tx`update users set status='inactive' where id=${f.user.id}`;
          if(target==='portfolio') await tx`update paper_portfolios set status='inactive' where id=${f.portfolio.id}`;
          if(target==='decision') await tx`update paper_trade_decisions set status='failed' where id=${f.decision.id}`;
          const decisionCall=()=>auth.run(f.user,()=>api.decisionPOST(new Request('http://isolated.test'),{params:Promise.resolve({id:String(f.decision.id)})}));
          calls=target==='decision' ? [decisionCall(),Promise.allSettled([ai(f)])] : [manual(f),decisionCall(),Promise.allSettled([ai(f)])];
          await waitForLocks(target==='decision'?2:3);
        });
        const results=await Promise.all(calls);
        const aiResult=results.at(-1)[0];
        assert.equal(aiResult.status,'rejected');
        assert(results.slice(0,-1).every(r=>r.status>=400));
        assert.equal((await state(f)).trades,0);
      }
      return {heldLockCases:3,pass:true};
    });
    await check('same key with concurrent different valid bodies', async () => {
      const f=await fixture({cash:10000}); const key=crypto.randomUUID();
      const rs=await Promise.all([manual(f,{quantity:1},key),manual(f,{quantity:2},key)]); const st=await state(f);
      return {...st,statuses:rs.map(r=>r.status),pass:rs.map(r=>r.status).sort().join(',')==='201,409' && st.trades===1 && st.cash===10000-st.quantity*100};
    });
    await check('storage overflow rolls back and does not consume idempotency key', async () => {
      const f=await fixture({cash:2147483647,quantity:1}); const key=crypto.randomUUID(); const before=await state(f);
      const overflow=await manual(f,{side:'sell',quantity:1},key); const after=await state(f);
      // Free capacity only in this isolated fixture; same key can then succeed.
      await sql`update paper_portfolios set cash_cents=1000 where id=${f.portfolio.id}`;
      const retry=await manual(f,{side:'sell',quantity:1},key);
      const g=await fixture({quantity:1}); await sql`update paper_positions set realized_pnl_cents=2147483647 where portfolio_id=${g.portfolio.id}`;
      const pnl=await manual(g,{side:'sell',quantity:1,price:2}); const gs=await state(g);
      const h=await fixture({quantity:2147483647}); const qty=await manual(h,{quantity:1}); const hs=await state(h);
      return {overflow:overflow.status,retry:retry.status,pnl:pnl.status,quantityOverflow:qty.status,
        pass:overflow.status===400 && isDeepStrictEqual(before,after) && retry.status===201 && pnl.status===400 && gs.trades===0 && gs.cash===1000 && qty.status===400 && hs.trades===0};
    });
    await check('exact weighted cost numerator beyond Number safe integer', async () => {
      const f=await fixture({cash:2147483647,quantity:10000000});
      await sql`update paper_positions set avg_cost_cents=1000000001,last_price_cents=1000000001 where portfolio_id=${f.portfolio.id}`;
      const r=await manual(f,{quantity:1,price:10000000});
      const expected=Number((2n*(10000000n*1000000001n+1000000000n)+10000001n)/(2n*10000001n));
      return {average:r.body.position?.avgCostCents,expected,pass:r.status===201 && r.body.position.avgCostCents===expected};
    });
    await check('malformed JSON and unsafe decision ID reject without writes', async () => {
      const f=await fixture();
      const r=await auth.run(f.user,()=>api.POST(new Request('http://isolated.test',{method:'POST',body:'{'})));
      const d=await auth.run(f.user,()=>api.decisionPOST(new Request('http://isolated.test'),{params:Promise.resolve({id:String(Number.MAX_SAFE_INTEGER+1)})}));
      return {manual:r.status,decision:d.status,pass:r.status===400 && d.status===400 && (await state(f)).trades===0};
    });
    await check('decision API repeated and concurrent requests', async () => {
      const f=await fixture(); const call=()=>auth.run(f.user,()=>api.decisionPOST(new Request('http://isolated.test'),{params:Promise.resolve({id:String(f.decision.id)})}));
      const rs=await Promise.all(Array.from({length:8},call)); const replay=await call(); const s=await state(f);
      return {...s,pass:rs.every(r=>r.status===200) && replay.status===200 && s.trades===1};
    });
    await check('independent processes concurrently claim the same new key', async () => {
      const f=await fixture(); const key=crypto.randomUUID();
      const inputPath=root+`/var/codex-team-round4/coordinator-process-case-${process.pid}.json`;
      fs.writeFileSync(inputPath,JSON.stringify({fixture:{user:{id:f.user.id},portfolio:{id:f.portfolio.id}},key}));
      const launch=()=>new Promise((resolve,reject)=>{
        const child=require('node:child_process').spawn(process.execPath,[__filename,'--process-trade-only'],{
          cwd:root,env:{...process.env,ROUND3_PROCESS_CASE:inputPath},stdio:['ignore','pipe','pipe']});
        let out='',error=''; child.stdout.on('data',data=>out+=data); child.stderr.on('data',data=>error+=data);
        child.on('error',reject);child.on('exit',code=>code===0 ? resolve(JSON.parse(out.trim())) : reject(new Error('Private child failed: '+error)));
      });
      try {
        const results=await Promise.all([launch(),launch()]); const final=await state(f);
        return {...final,processes:2,pass:results.every(r=>r.status===201) && isDeepStrictEqual(results[0].body,results[1].body) && final.trades===1 && final.cash===900 && final.quantity===1};
      } finally {fs.unlinkSync(inputPath)}
    });
    await check('portfolio setup cannot reset cash after a concurrent first trade', async () => {
      const f=await fixture();
      await sql`delete from paper_positions where portfolio_id=${f.portfolio.id}`;
      let buy, setup;
      const waitForLocks=async count=>{
        for(let i=0;i<100;i++) {
          const [r]=await sql`select count(*)::int as count from pg_stat_activity where datname=${dbName} and wait_event_type='Lock'`;
          if(r.count>=count) return;
          await new Promise(r=>setTimeout(r,10));
        }
        throw new Error('Expected blocked portfolio writers');
      };
      await sql.begin(async tx=>{
        await tx`select id from paper_portfolios where id=${f.portfolio.id} for update`;
        buy=manual(f,{quantity:1}); await waitForLocks(1);
        setup=auth.run(f.user,()=>api.portfolioPOST(new Request('http://isolated.test/api/paper/portfolio',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initialCash:20})
        }))); await waitForLocks(2);
      });
      const [b,r]=await Promise.all([buy,setup]); const final=await state(f);
      return {...final,buyStatus:b.status,setupStatus:r.status,pass:b.status===201 && r.status===400 && final.cash===900 && final.trades===1};
    });
    await check('database constraints reject invalid future writes', async () => {
      const f=await fixture(); let rejected=0;
      for(const query of [()=>sql`update paper_portfolios set cash_cents=-1 where id=${f.portfolio.id}`,()=>sql`update paper_positions set quantity=-1 where portfolio_id=${f.portfolio.id}`]) {
        try {await query()} catch {rejected++}
      }
            await ai(f);
      const [trade]=await sql`select * from paper_trades where portfolio_id=${f.portfolio.id}`;
      for(const query of [()=>sql`insert into paper_trades(portfolio_id,user_id,position_id,decision_id,ticker,side,quantity,price_cents,gross_amount_cents) values(${f.portfolio.id},${f.user.id},${trade.position_id},${trade.decision_id},'TEST','buy',1,100,100)`,()=>sql`update paper_trades set gross_amount_cents=99 where id=${trade.id}`]) {
        try {await query()} catch {rejected++}
      }
      return {rejected,pass:rejected===4};
    });
  }
  console.log(JSON.stringify({completed:checks,mode:baseline?'baseline':'fixed'}));
})().catch(e=>{ console.error(e.message);process.exitCode=1 }).finally(async()=>{if(api) await api.client.end();await sql.end()});
