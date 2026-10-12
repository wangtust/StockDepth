// Read-only. Outputs query IDs and timings, never SQL text or credentials.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, { max: 1 });
(async () => {
  try {
    const samples = [];
    for (let i = 0; i < 11; i++) {
      const start = performance.now(); await sql`select 1`;
      if (i) samples.push(Math.round(performance.now() - start));
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ name: 'db_roundtrip', samples: samples.length, p50: samples[4], p95: samples[9] }));
    const [extension] = await sql`select exists(select 1 from pg_extension where extname = 'pg_stat_statements') as available`;
    if (extension.available) {
      const stats = await sql`select queryid::text, calls::text, round(mean_exec_time::numeric, 3) as mean_ms,
        round(total_exec_time::numeric, 3) as total_ms, rows::text from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
        order by total_exec_time desc limit 15`;
      console.log(JSON.stringify({ name: 'query_statistics', stats }));
    } else {
      console.log(JSON.stringify({ name: 'query_statistics', available: false, reason: 'pg_stat_statements is not installed; Server-Timing and EXPLAIN remain available' }));
    }
    const connections = await sql`select application_name, state, count(*)::int as connections from pg_stat_activity
      where datname = current_database() group by application_name, state`;
    console.log(JSON.stringify({ name: 'db_connections', connections }));
  } finally { await sql.end(); }
})().catch(e => { console.error('Database stats failed:', e.code || e.name); process.exitCode = 1; });
