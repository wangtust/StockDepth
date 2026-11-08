import {publicRateLimited} from '@/lib/http/public-rate-limit';
import {NextResponse} from 'next/server';
import {getSharedJob} from '@/lib/analysis/shared-jobs';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{publicId:string}>}) {
 if(publicRateLimited(request))return NextResponse.json({error:'Too many requests'},{status:429,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
 const {publicId}=await params;
 const result=z.string().uuid().safeParse(publicId).success?await getSharedJob(publicId):null;
 return NextResponse.json(result||{error:'Not found'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});
}
