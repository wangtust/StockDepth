// Read-only transaction. No dotenv, credentials, personal data, or asset values in output.
const root = require('node:path').resolve(__dirname,'../..');
const crypto = require('node:crypto');
const sql = require(root+'/apps/web/node_modules/postgres')(process.env.POSTGRES_URL,{max:1,onnotice(){}});
const relations = [
 ['paper_positions','portfolio_id','paper_portfolios','user_id'],
 ['paper_trades','portfolio_id','paper_portfolios','user_id'],
 ['paper_trade_requests','portfolio_id','paper_portfolios','user_id'],
 ['paper_analysis_runs','portfolio_id','paper_portfolios','user_id'],
 ['paper_trade_decisions','portfolio_id','paper_portfolios','user_id'],
 ['paper_analysis_runs','analysis_job_id','analysis_jobs','user_id'],
 ['paper_analysis_runs','watchlist_item_id','watchlist_items','user_id'],
 ['paper_trades','position_id','paper_positions','user_id','portfolio_id'],
 ['paper_trades','decision_id','paper_trade_decisions','user_id','portfolio_id'],
 ['paper_trade_decisions','paper_analysis_run_id','paper_analysis_runs','user_id','portfolio_id','analysis_job_id'],
];
(async()=>{await sql.begin('isolation level repeatable read read only',async tx=>{
 const assets={};
 for(const [table,fields] of [
 ['paper_portfolios','id,user_id,initial_cash_cents,cash_cents,currency,status,auto_trade_enabled'],
 ['paper_positions','id,portfolio_id,user_id,ticker,quantity,avg_cost_cents,last_price_cents,realized_pnl_cents'],
 ['paper_trades','id,portfolio_id,user_id,ticker,side,quantity,price_cents,gross_amount_cents,fee_cents,realized_pnl_cents']]){
  assets[table]=await tx.unsafe(`select ${fields} from ${table} order by id`);
  for(const row of assets[table])for(const key of Object.keys(row))if(key.endsWith('_cents'))row[key]=String(row[key]);
 }
 console.log(JSON.stringify({readOnly:true,assetHash:crypto.createHash('sha256').update(JSON.stringify(assets)).digest('hex'),counts:Object.fromEntries(Object.entries(assets).map(([k,v])=>[k,v.length]))}));
 for(const [child,ref,parent,...fields] of relations){
  const mismatches=await tx.unsafe(`select c.id from ${child} c left join ${parent} p on p.id=c.${ref} where c.${ref} is not null and (p.id is null or ${fields.map(f=>`c.${f} is distinct from p.${f}`).join(' or ')}) order by c.id`);
  console.log(JSON.stringify({relation:child+'.'+ref,anomalies:mismatches.length,ids:mismatches.slice(0,100).map(r=>r.id)}));
 }
 const constraints=await tx`select conrelid::regclass::text as table_name,conname,contype,convalidated from pg_constraint where connamespace='public'::regnamespace and not convalidated order by conrelid::regclass::text,conname`;
 console.log(JSON.stringify({unvalidatedConstraints:constraints}));
});})().catch(()=>{console.error('read_only_audit_failed');process.exitCode=1;}).finally(()=>sql.end());
