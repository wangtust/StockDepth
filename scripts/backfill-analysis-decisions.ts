import { config } from '../apps/web/node_modules/dotenv';
config({path:'.env'});
async function main() {
  const {db,client} = await import('../apps/web/lib/db/drizzle');
  const {analysisJobs,analysisReports,analysisDecisions} = await import('../apps/web/lib/db/schema');
  const {extractDecision} = await import('../apps/web/lib/analysis/decision-extraction');
  const {and,eq,gt,asc} = await import('../apps/web/node_modules/drizzle-orm');
  let cursor=0, total=0, recognized=0;
  try {
    // Link only unique, verified vendor identities; never infer an exchange from a symbol.
    await client`with matches as (
      select j.id, min(i.id) as instrument_id from analysis_jobs j
      join instrument_sources s on s.vendor = 'yahoo' and s.status = 'verified'
        and s.vendor_symbol = regexp_replace(upper(trim(j.ticker)), '\\.SH$', '.SS')
      join instruments i on i.id = s.instrument_id and i.status = 'verified'
      where j.instrument_id is null group by j.id having count(distinct i.id) = 1
    ) update analysis_jobs j set instrument_id = m.instrument_id from matches m where j.id = m.id and j.instrument_id is null`;
    while (true) {
      const rows=await db.select({id:analysisReports.id,jobId:analysisJobs.id,content:analysisReports.content}).from(analysisReports)
        .innerJoin(analysisJobs,and(eq(analysisJobs.id,analysisReports.jobId),eq(analysisJobs.userId,analysisReports.userId)))
        .where(and(eq(analysisReports.reportKey,'decision'),eq(analysisJobs.status,'complete'),gt(analysisReports.id,cursor))).orderBy(asc(analysisReports.id)).limit(200);
      if (!rows.length) break;
      for (const row of rows) {
        const result=extractDecision(row.content);
        await db.insert(analysisDecisions).values({jobId:row.jobId,...result}).onConflictDoUpdate({target:analysisDecisions.jobId,set:{...result,extractedAt:new Date(),updatedAt:new Date()}});
        total++; if(result.action) recognized++;
      }
      cursor=rows.at(-1)!.id;
    }
    console.log(`Processed ${total} reports: ${recognized} recognized, ${total-recognized} unrecognized.`);
  } finally {await client.end();}
}
main().catch(() => { console.error('Backfill failed; check database connectivity and schema.'); process.exitCode=1; });
