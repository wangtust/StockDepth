import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { listInstruments } from '@/lib/market/service';
export async function GET(request:Request) {
  if (!await getUser()) return NextResponse.json({error:'Unauthorized'},{status:401});
  const params=new URL(request.url).searchParams;
  const before=params.get('before'),limit=params.get('limit'),q=params.get('q')??'';
  if (q.length>80 || (before!==null && (!/^\d+$/.test(before)||Number(before)<1||Number(before)>2147483647)) || (limit!==null && (!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>100))) return NextResponse.json({error:'Invalid query'},{status:400});
  return NextResponse.json(await listInstruments({q,before:before?Number(before):undefined,limit:limit?Number(limit):30}));
}
