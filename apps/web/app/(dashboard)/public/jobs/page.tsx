import Link from 'next/link';
import {listSharedJobs,sharedCursorPattern} from '@/lib/analysis/shared-jobs';
import {z} from 'zod';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const params=await searchParams;const ticker=params.ticker?.slice(0,40)||undefined;const language=params.language?.slice(0,40)||undefined;
 const cursor=z.string().regex(sharedCursorPattern).safeParse(params.before);
 const before=cursor.success&&Number.isFinite(Date.parse(cursor.data.split('_')[0]))&&new Date(cursor.data.split('_')[0]).toISOString()===cursor.data.split('_')[0]?cursor.data:undefined;
 const date=params.date&&/^\d{4}-\d{2}-\d{2}$/.test(params.date)?params.date:undefined;
 const result=await listSharedJobs({ticker,date,language,before,limit:20});
 const next=new URLSearchParams({...ticker?{ticker}:{},...date?{date}:{},...language?{language}:{},before:result.nextCursor||''});
 return <main className="mx-auto max-w-5xl space-y-6 p-6"><h1 className="text-3xl font-semibold">Public analyses</h1><p>Completed research shared by the community. Authors are anonymous. Analysis is not investment advice.</p><form className="flex flex-wrap gap-3"><input aria-label="Ticker" name="ticker" placeholder="Ticker" defaultValue={ticker} className="rounded border p-2"/><input aria-label="Analysis date" name="date" type="date" defaultValue={date} className="rounded border p-2"/><select aria-label="Language" name="language" defaultValue={language||''} className="rounded border p-2"><option value="">All languages</option><option>English</option><option>Chinese</option></select><button className="rounded border px-4">Filter</button></form><div className="space-y-3">{result.jobs.map(job=><Link key={job.publicId} href={`/public/jobs/${job.publicId}`} className="block rounded-xl border p-5 hover:bg-slate-50"><h2 className="text-xl font-medium">{job.ticker}</h2><p>{job.tradeDate} · {job.language} · Depth {job.depth}</p><p className="text-sm text-slate-500">Anonymous · Published {job.publishedAt?.toISOString().slice(0,10)}</p></Link>)}{!result.jobs.length&&<p>No public analyses found.</p>}</div>{result.nextCursor&&<Link href={`?${next}`}>Next page →</Link>}</main>;
}
