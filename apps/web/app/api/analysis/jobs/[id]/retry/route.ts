import {publicAnalysisJob} from '@/lib/analysis/public-job';
import {resumeAnalysisJob} from '@/lib/analysis/resume-job';
import {NextRequest,NextResponse} from 'next/server';
import {getUser} from '@/lib/db/queries';
import {z} from 'zod';
const replacementSchema=z.object({quickModelConfigId:z.number().int().positive().max(2147483647),deepModelConfigId:z.number().int().positive().max(2147483647)}).strict();
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const user=await getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
  const id=Number((await params).id);if(!Number.isSafeInteger(id)||id<1||id>2147483647)return NextResponse.json({error:'Not found'},{status:404});
  const raw=await request.text();if(raw.length>1024)return NextResponse.json({error:'Invalid request'},{status:400});let replacement;
  if(raw.trim()) {
    try {const parsed=replacementSchema.safeParse(JSON.parse(raw));if(!parsed.success)return NextResponse.json({error:'请选择有效的 Quick 和 Deep 模型。'},{status:400});replacement=parsed.data;}
    catch{return NextResponse.json({error:'Invalid request'},{status:400});}
  }
  try {
    const result=await resumeAnalysisJob(user.id,id,replacement);
    if('error' in result)return NextResponse.json({error:result.error},{status:result.status});
    return NextResponse.json({job:publicAnalysisJob(result.job)});
  }catch{return NextResponse.json({error:'无法继续任务，请检查模型密钥配置后重试。'},{status:503});}
}
