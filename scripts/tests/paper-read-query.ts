// Read-only real-database regression; prints only timing/counts, never payloads or credentials.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
async function main() {
  const { db, client } = await import('../../apps/web/lib/db/drizzle');
  const { sql } = require(root + '/apps/web/node_modules/drizzle-orm');
  const { readOriginalPaper } = await import('./paper-original-query');
  const { readPaperOverview, readPaperDetails } = await import('../../apps/web/lib/paper/read-query');
  try {
    const [user] = await db.execute(sql`select id, analysis_credits from users where status='active' and deleted_at is null
      and exists(select 1 from paper_portfolios where user_id=users.id and status='active') order by (role='member') desc,id limit 1`);
    assert(user, 'Needs active portfolio fixture');
    const currentUser = {id: Number(user.id), analysisCredits: Number(user.analysis_credits)};
    let queries = 0;
    const unsafe = client.unsafe.bind(client);
    client.unsafe = ((...args: Parameters<typeof client.unsafe>) => { queries++; return unsafe(...args); }) as typeof client.unsafe;
    const results: object[] = [];
    for (let i = 0; i < 4; i++) {
      queries = 0; let start = performance.now();
      const old = await readOriginalPaper(currentUser);
      const oldMs = performance.now()-start, oldQueries = queries;
      queries = 0; start = performance.now();
      const overview = await readPaperOverview(currentUser.id);
      const [positions,trades,analysisRuns] = overview.portfolio ? await readPaperDetails(overview.portfolio) : [[],[],[]];
      const next = { credits: currentUser.analysisCredits, ...overview, positions,trades,analysisRuns };
      const newMs = performance.now()-start, newQueries = queries;
      const [activity] = await db.execute(sql`select exists(select 1 from paper_analysis_runs r
        join analysis_jobs j on j.id=r.analysis_job_id where r.portfolio_id=${overview.portfolio?.id ?? -1}
        and j.status in ('queued','running')) as active`);
      assert.equal(overview.hasActiveAnalysisRuns, activity.active);
      const actual = JSON.parse(JSON.stringify(next)), expected = JSON.parse(JSON.stringify(old));
      delete actual.hasActiveAnalysisRuns;
      // Round 3 adds an optional decision link; all pre-migration trades remain unlinked.
      for (const trade of expected.trades) {
        assert.equal(trade.decisionId, null, 'Historical trades must not be backfilled');
        delete trade.decisionId;
      }
      // The original grouped query had undefined ordering for equal timestamps.
      for(const payload of [actual,expected]) payload.analysisRuns.sort((a: any,b: any)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id-a.id);
      function differences(a: any,b: any,p=''): string[] {
        if(JSON.stringify(a)===JSON.stringify(b)) return [];
        if(a && b && typeof a==='object' && typeof b==='object') return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differences(a[k],b[k],p+'.'+k));
        return [p];
      }
      const diff = differences(actual,expected);
      if(diff.length) console.log(JSON.stringify({differentFields:diff}));
      assert.deepEqual(actual, expected, 'Payload incl. dates/cents must match baseline');
      assert(!JSON.stringify(next).includes('apiKey'));
      if(i) results.push({oldMs:Math.round(oldMs),newMs:Math.round(newMs),oldQueries,newQueries,bytes:Buffer.byteLength(JSON.stringify(next))});
    }
    // No active portfolio: do not infer ownership from an arbitrary portfolio ID.
    const missing = await readPaperOverview(-1);
    assert.equal(missing.portfolio,null); assert.deepEqual(missing.watchlist,[]);
    // Validate merged numeric aggregation against both original subqueries for ALL tasks/calls.
    const [mismatch] = await db.execute(sql`select count(*)::int as count from analysis_jobs j
      left join lateral (select sum(estimated_cost)::text as total, bool_and(cost_complete) as complete
        from analysis_model_calls where job_id=j.id) c on true
      where c.total is distinct from (select sum(estimated_cost)::text from analysis_model_calls where job_id=j.id)
      or coalesce(c.complete,false) is distinct from coalesce((select bool_and(cost_complete) from analysis_model_calls where job_id=j.id),false)`);
    assert.equal(mismatch.count,0);
    // Execute the query extracted from the actual page, avoiding its rendering/actions imports.
    const pageSource = fs.readFileSync(root+'/apps/web/app/admin/jobs/page.tsx','utf8');
    const querySource = pageSource.slice(pageSource.indexOf('  const pageRows = await db'),pageSource.indexOf('  const rows = pageRows.slice'));
    const ts = require(root+'/apps/web/node_modules/typescript');
    const body = ts.transpile(`async function read(whereParts, pageSize) { ${querySource} return pageRows; } return read;`,{target:ts.ScriptTarget.ES2022});
    const orm = require(root+'/apps/web/node_modules/drizzle-orm');
    const schema = await import('../../apps/web/lib/db/schema');
    const readAdmin = new Function('db','sql','analysisJobs','users','eq','and','desc',body)(db,sql,schema.analysisJobs,schema.users,orm.eq,orm.and,orm.desc);
    const seen = new Set<number>(); let before: number | undefined;
    for(let page=0;page<4;page++) {
      const rows = await readAdmin(before ? [orm.lt(schema.analysisJobs.id,before)] : [],50);
      for(const row of rows.slice(0,50)) { const id=Number(row.id); assert(!seen.has(id)); if(before) assert(id<before); seen.add(id); }
      if(rows.length<=50) break; before=Number(rows[49].id);
    }
    const filtered = await readAdmin([orm.eq(schema.analysisJobs.status,'complete')],50);
    assert(filtered.every((row: any)=>row.status==='complete'));
    for(const row of filtered) {
      const [expected] = await db.execute(sql`select sum(estimated_cost)::text as total,coalesce(bool_and(cost_complete),false) as complete from analysis_model_calls where job_id=${row.id}`);
      assert.equal(row.costTotal,expected.total);assert.equal(row.costComplete,expected.complete);
    }
    console.log(JSON.stringify({name:'new_source_paper_query_regression',samples:results,adminAggregationMismatches:0,pagedJobs:seen.size,checks:'payload/dates/cents/public model/empty portfolio/all historical costs/cursor uniqueness'}));
  } finally {await client.end();}
}
main().catch(e=>{console.error('Paper source regression failed:',['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(e.code) ? e.message : (e.code||e.name));process.exitCode=1;});
