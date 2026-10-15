import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueSignupCode } from '@/lib/auth/signup-email';
const schema=z.object({email:z.string().trim().email().max(255).transform(value=>value.toLowerCase())});
export async function POST(request:Request) {
  const origin=request.headers.get('origin');
  try {
    if (!origin || new URL(origin).host !== request.headers.get('host')) return NextResponse.json({error:'Invalid origin'},{status:403});
  } catch { return NextResponse.json({error:'Invalid origin'},{status:403}); }
  const raw=await request.text();
  if (raw.length>2048) return NextResponse.json({error:'Invalid request'},{status:400});
  let parsed;
  try { parsed=schema.safeParse(JSON.parse(raw)); } catch { return NextResponse.json({error:'Invalid email address'},{status:400}); }
  if (!parsed.success) return NextResponse.json({error:'Invalid email address'},{status:400});
  try {
    const result=await issueSignupCode(parsed.data.email,request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown');
    return NextResponse.json(result,{status:result.error?('rateLimited' in result && result.rateLimited ? 429 : 503):200,headers:{'Cache-Control':'no-store'}});
  } catch { return NextResponse.json({error:'Email verification is temporarily unavailable.'},{status:503}); }
}
