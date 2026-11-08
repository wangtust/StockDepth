import {and,eq,isNull,sql} from 'drizzle-orm';
import {db} from '../db/drizzle';
import {analysisJobs as jobs,analysisReports as reports,users,activityLogs} from '../db/schema';

export async function setJobVisibility(userId:number,id:number,visibility:'public'|'private') {
  return db.transaction(async tx=>{
    const [existing]=await tx.select().from(jobs).where(and(eq(jobs.id,id),eq(jobs.userId,userId),isNull(jobs.hiddenAt))).for('update');
    if(!existing)return {error:'Not found',status:404};
    if(visibility==='public'&&existing.status!=='complete')return {error:'Only completed jobs can be public',status:409};
    if(existing.visibility!==visibility) {
      await tx.update(jobs).set({visibility,publishedAt:visibility==='public'?new Date():null}).where(eq(jobs.id,id));
      await tx.insert(activityLogs).values({userId,action:`analysis_job_visibility:${id}:${visibility}`});
    }
    return {visibility,publicId:existing.publicId,status:200};
  });
}
export const sharedCursorPattern=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eligible=and(eq(jobs.visibility,'public'),eq(jobs.status,'complete'),isNull(jobs.hiddenAt),eq(users.status,'active'),isNull(users.deletedAt));
// Deliberate allowlist. Author is anonymous; account names/emails never leave this API.
const fields={publicId:jobs.publicId,ticker:jobs.ticker,tradeDate:jobs.tradeDate,language:jobs.language,depth:jobs.depth,completedAt:jobs.completedAt,publishedAt:jobs.publishedAt};
export async function listSharedJobs(filters:{ticker?:string;date?:string;language?:string;before?:string;limit:number}) {
  const rows=await db.select(fields).from(jobs).innerJoin(users,eq(users.id,jobs.userId)).where(and(eligible,
    filters.ticker?eq(jobs.ticker,filters.ticker):undefined,filters.date?eq(jobs.tradeDate,filters.date):undefined,
    filters.language?eq(jobs.language,filters.language):undefined,
    filters.before?sql`(${jobs.publishedAt},${jobs.publicId}) < (${filters.before.split('_')[0]}::timestamptz,${filters.before.split('_')[1]}::uuid)`:undefined
  )).orderBy(sql`${jobs.publishedAt} desc`,sql`${jobs.publicId} desc`).limit(filters.limit+1);
  return {jobs:rows.slice(0,filters.limit),nextCursor:rows.length>filters.limit?`${rows[filters.limit-1].publishedAt!.toISOString()}_${rows[filters.limit-1].publicId}`:null};
}
// Defensive redaction for common credential/path formats in published prose.
// Publication still shares user-approved report content; this is not a general DLP engine.
export function sanitizeSharedReport(content:string) {
 return content
   .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi,'Bearer [redacted]')
   .replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[redacted]')
   .replace(/((?:api[_-]?key|access[_-]?token|password|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,'$1[redacted]')
   .replace(/postgres(?:ql)?:\/\/[^\s)"'<>]+/gi,'[database connection]')
   .replace(/\/(?:home|tmp|var|root)\/[^\s)"'<>]+/g,'[internal path]');
}
// Only final report keys are shared; execution/progress include tool traces.
export const sharedReportKeys=['market','news','fundamentals','sentiment','research','trader','risk','decision','bull','bear','aggressive','conservative','neutral','research_debate','risk_debate'];
export async function getSharedJob(publicId:string) {
  const rows=await db.select({...fields,reportKey:reports.reportKey,title:reports.title,content:reports.content}).from(jobs)
    .innerJoin(users,eq(users.id,jobs.userId)).leftJoin(reports,and(eq(reports.jobId,jobs.id),eq(reports.userId,jobs.userId),sql`${reports.reportKey} in (${sql.join(sharedReportKeys.map(k=>sql`${k}`),sql`,`)})`))
    .where(and(eligible,eq(jobs.publicId,publicId))).orderBy(reports.id);
  if(!rows.length)return null;
  const {reportKey,title,content,...job}=rows[0];
  return {job,reports:rows.filter(r=>r.reportKey).map(r=>({reportKey:r.reportKey!,title:sanitizeSharedReport(r.title!),content:sanitizeSharedReport(r.content!)}))};
}
