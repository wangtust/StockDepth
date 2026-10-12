// Production cleanup disabled: this tool only reports bounded retention candidates.
// Idempotency results have no guaranteed expiry contract; retain ALL of them.
import postgres from '../apps/web/node_modules/postgres';
if (process.argv.includes('--apply')) throw new Error('Production cleanup disabled; dry-run only');
if (!process.env.POSTGRES_URL) throw new Error('Database environment required');
const db = postgres(process.env.POSTGRES_URL, { max: 1, onnotice() {} });
async function main() {
 await db.begin('isolation level repeatable read read only', async tx => {
  const [counts] = await tx`
   select (select count(*) from price_snapshots q where q.fetched_at < now()-interval '90 days'
    and not exists(select 1 from paper_trades t where t.price_snapshot_id=q.id)
    and not exists(select 1 from market_sync_state s where s.instrument_id=q.instrument_id and s.lease_until>now())
    and not exists(select 1 from price_snapshots newest where newest.id=q.id and not exists
      (select 1 from price_snapshots other where other.instrument_id=q.instrument_id and
       (other.quoted_at,other.id)>(q.quoted_at,q.id)))) as quote_candidates,
   (select count(*) from market_sync_runs r where r.ended_at is not null and r.ended_at < now()-interval '90 days'
     and not exists(select 1 from market_sync_state s where s.owner=r.owner and s.lease_until>now())) as run_candidates,
   (select count(*) from paper_trade_requests) as replay_retained,
   (select count(*) from price_snapshots) as quotes_total,
   (select count(*) from market_sync_runs) as runs_total,
   (select count(*) from daily_prices) as daily_retained`;
  console.log(JSON.stringify({dryRun:true, automaticCleanup:false, ...counts}));
 });
}
main().catch(() => { console.error('retention_audit_failed'); process.exitCode=1; }).finally(() => db.end());
