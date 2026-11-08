import {notFound} from 'next/navigation';
import Link from 'next/link';
import {z} from 'zod';
import {getSharedJob} from '@/lib/analysis/shared-jobs';
import {MarkdownRenderer} from '@/components/markdown-renderer';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{publicId:string}>}) {
 const {publicId}=await params;if(!z.string().uuid().safeParse(publicId).success)notFound();
 const result=await getSharedJob(publicId);if(!result)notFound();
 return <main className="mx-auto max-w-5xl space-y-8 p-6"><Link href="/public/jobs">← Public analyses</Link><header><h1 className="text-3xl font-semibold">{result.job.ticker} analysis</h1><p>{result.job.tradeDate} · {result.job.language} · Depth {result.job.depth} · Anonymous</p><p className="text-sm text-slate-500">Shared research, not investment advice.</p></header>{result.reports.map(report=><section key={report.reportKey} className="rounded-xl border p-6"><h2 className="mb-4 text-2xl font-semibold">{report.title}</h2><MarkdownRenderer content={report.content}/></section>)}{!result.reports.length&&<p>No final reports available.</p>}</main>;
}
