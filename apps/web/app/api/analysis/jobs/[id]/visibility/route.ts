import {NextRequest,NextResponse} from 'next/server';
import {getUser} from '@/lib/db/queries';
import {setJobVisibility} from '@/lib/analysis/shared-jobs';
export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const user=await getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const origin=request.headers.get('origin');
 const configuredOrigin=process.env.BASE_URL?new URL(process.env.BASE_URL).origin:request.nextUrl.origin;
 let matchesHost = false;
 if(origin) {
   try { const url = new URL(origin); matchesHost = ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.get('host'); } catch {}
 }
 if(origin&&origin!==configuredOrigin&&origin!==request.nextUrl.origin&&!matchesHost)return NextResponse.json({error:'Invalid origin'},{status:403});
 const id=Number((await params).id);if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Not found'},{status:404});
 const body=await request.json().catch(()=>null);if(!body||!['public','private'].includes(body.visibility))return NextResponse.json({error:'Invalid visibility'},{status:400});
 const result=await setJobVisibility(user.id,id,body.visibility);return NextResponse.json(result,{status:result.status,headers:{'Cache-Control':'no-store'}});
}
