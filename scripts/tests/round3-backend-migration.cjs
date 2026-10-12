// Upgrade only the private OLD baseline database; no dotenv or production URL accepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../..');
const modules = root+'/apps/web/node_modules';
const postgres = require(modules+'/postgres');
const {drizzle} = require(modules+'/drizzle-orm/postgres-js');
const {migrate} = require(modules+'/drizzle-orm/postgres-js/migrator');
const dbName = process.env.ROUND3_TEST_DATABASE;
assert.match(dbName || '',/^stockdepth_round3_backend_baseline_[a-z0-9_]+$/);
const sql = postgres(`postgres://ubuntu@127.0.0.1:55483/${dbName}`,{max:1});
async function assets() {
  return {
    portfolios: await sql`select * from paper_portfolios order by id`,
    positions: await sql`select * from paper_positions order by id`,
    trades: await sql`select id,portfolio_id,user_id,position_id,ticker,side,quantity,price_cents,gross_amount_cents,fee_cents,realized_pnl_cents,note,created_at from paper_trades order by id`,
    decisions: await sql`select * from paper_trade_decisions order by id`
  };
}
(async()=>{
  const [identity]=await sql`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;
  assert.equal(identity.name,dbName);assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55483);
  const [old]=await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(old.count,25,'Requires old implementation baseline with full original migrations');
  const before=await assets();assert(before.portfolios.some(p=>p.cash_cents<0),'Baseline must contain historical invalid cash');
  await migrate(drizzle(sql),{migrationsFolder:root+'/apps/web/lib/db/migrations'});
  const after=await assets();assert.deepEqual(after,before,'Migration must not rewrite historical assets');
  const [next]=await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  assert.equal(next.count,JSON.parse(fs.readFileSync(root+'/apps/web/lib/db/migrations/meta/_journal.json')).entries.length);
  const constraints=await sql`select conname,convalidated from pg_constraint where conname in ('paper_portfolios_cash_nonnegative','paper_positions_amounts_nonnegative','paper_trades_amounts_valid')`;
  assert.equal(constraints.length,3);assert(constraints.every(c=>!c.convalidated));
  const [backfill]=await sql`select count(*)::int as count from paper_trades where decision_id is not null`;assert.equal(backfill.count,0);
  await migrate(drizzle(sql),{migrationsFolder:root+'/apps/web/lib/db/migrations'});
  assert.deepEqual(await assets(),before,'Repeated migration must remain harmless');
  console.log(JSON.stringify({test:'full baseline database upgrade and repeat migration',migrations:next.count,historicalAssetsUnchanged:true,checksNotValid:constraints.length,decisionBackfill:backfill.count,pass:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>sql.end());
