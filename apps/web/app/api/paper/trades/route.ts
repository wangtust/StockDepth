import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { executeManualTrade, manualTradeSchema, PaperTradeError, parseIdempotencyKey } from '@/lib/paper/trading';

export async function POST(request: NextRequest) {
  const currentUser = await getUser();
  if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const parsed = manualTradeSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
    const key = parseIdempotencyKey(request.headers.get('Idempotency-Key'));
    const result = await executeManualTrade(currentUser.id, parsed.data, key);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PaperTradeError ? error.message : 'Trade failed.' },
      { status: error instanceof PaperTradeError ? error.status : 400 });
  }
}
