import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { instrumentDetail } from '@/lib/market/service';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  if (!await getUser()) return NextResponse.json({error:'Unauthorized'},{status:401});
  const {id}=await params;
  const search=new URL(request.url).searchParams,before=search.get('before'),limit=search.get('limit');
  if (!/^\d+$/.test(id)||Number(id)<1||Number(id)>2147483647 || (before!==null && (!/^\d{4}-\d{2}-\d{2}$/.test(before)||!Number.isFinite(Date.parse(before))||new Date(before).toISOString().slice(0,10)!==before)) || (limit!==null && (!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>370))) return NextResponse.json({error:'Invalid query'},{status:400});
  const result=await instrumentDetail(Number(id),{before:before??undefined,limit:limit?Number(limit):260});
  return result?NextResponse.json(result):NextResponse.json({error:'Not found'},{status:404});
}
