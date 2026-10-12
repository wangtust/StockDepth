import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { executePaperDecisionForUser } from '@/lib/paper/execution';
import { PaperTradeError } from '@/lib/paper/trading';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const currentUser = await getUser();
  if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    return NextResponse.json({ error: 'Invalid decision.' }, { status: 400 });
  }
  try {
    const result = await executePaperDecisionForUser(id, currentUser.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof PaperTradeError ? error.message : 'Execution failed.' },
      { status: error instanceof PaperTradeError ? error.status : 400 });
  }
}
