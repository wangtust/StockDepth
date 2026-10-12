import { AmountRangeError } from '@/lib/paper/amount';
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { RequestTiming } from '@/lib/http/request-timing';
import { readPaperOverview, readPaperDetails } from '@/lib/paper/read-query';

export async function GET() {
  const timing = new RequestTiming();
  const currentUser = await timing.measure('auth', () => getUser());
  if (!currentUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: timing.headers() });
  }
  try {
    const overview = await timing.measure('overview', () => readPaperOverview(currentUser.id));
    const [positions, trades, analysisRuns] = overview.portfolio
      ? await timing.measure('details', () => readPaperDetails(overview.portfolio!))
      : [[], [], []];
    return NextResponse.json({
      credits: currentUser.analysisCredits ?? 0,
      ...overview,
      positions,
      trades,
      analysisRuns
    }, { headers: timing.headers() });
  } catch (error) {
    if (error instanceof AmountRangeError) return NextResponse.json(
      { error: 'Stored monetary amount exceeds the supported safe integer range.' },
      { status: 422, headers: timing.headers() }
    );
    throw error;
  }
}
