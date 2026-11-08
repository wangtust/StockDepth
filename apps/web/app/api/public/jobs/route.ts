import {publicRateLimited} from '@/lib/http/public-rate-limit';
import {NextRequest,NextResponse} from 'next/server';
import {listSharedJobs,sharedCursorPattern} from '@/lib/analysis/shared-jobs';
import {z} from 'zod';
export const dynamic='force-dynamic';
const schema=z.object({ticker:z.string().trim().min(1).max(40).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),language:z.string().max(40).optional(),before:z.string().regex(sharedCursorPattern).refine(v=>{const t=v.split('_')[0];const n=Date.parse(t);return Number.isFinite(n)&&new Date(n).toISOString()===t;}).optional(),limit:z.coerce.number().int().min(1).max(50).default(20)});
export async function GET(request:NextRequest) {
 if(publicRateLimited(request))return NextResponse.json({error:'Too many requests'},{status:429,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
 const parsed=schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
 if(!parsed.success)return NextResponse.json({error:'Invalid filters'},{status:400});
 return NextResponse.json(await listSharedJobs(parsed.data),{headers:{'Cache-Control':'no-store'}});
}
