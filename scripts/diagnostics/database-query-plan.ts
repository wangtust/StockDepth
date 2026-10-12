// Reuses the production query, outputs plan timings/indexes only, never SQL text.
import path from 'node:path';
import { jobsPageQuery } from '../../apps/web/lib/analysis/jobs-page-query';

const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const postgres = require(root + '/apps/web/node_modules/postgres');
const { PgDialect } = require(root + '/apps/web/node_modules/drizzle-orm/pg-core');
const sql = postgres(process.env.POSTGRES_URL, { max: 1, connection: { TimeZone: 'UTC' } });
async function main() {
  try {
    const [user] = await sql`select u.id from users u where u.status='active' and u.deleted_at is null
      and exists(select 1 from analysis_jobs j where j.user_id=u.id and j.hidden_at is null)
      order by (u.role='member') desc, u.id limit 1`;
    if (!user) throw Error('No active user with jobs');
    const query = new PgDialect().sqlToQuery(jobsPageQuery(user.id));
    const samples: number[] = [];
    let plan: any;
    for (let i = 0; i < 4; i++) {
      const [row] = await sql.unsafe('explain (analyze, buffers, format json) ' + query.sql, query.params);
      plan = row['QUERY PLAN'][0];
      if (i) samples.push(plan['Execution Time']);
    }
    const nodes: object[] = [];
    function visit(node: any) {
      nodes.push({ type: node['Node Type'], index: node['Index Name'], rows: node['Actual Rows'],
        loops: node['Actual Loops'], totalMs: node['Actual Total Time'] });
      for (const child of node.Plans || []) visit(child);
    }
    visit(plan.Plan);
    console.log(JSON.stringify({ name: 'production_jobs_sql', executionSamplesMs: samples,
      planningMs: plan['Planning Time'], sharedHits: plan.Plan['Shared Hit Blocks'], nodes }));
  } finally { await sql.end(); }
}
main().catch(e => { console.error('Query plan failed:', e.code || e.name); process.exitCode = 1; });
