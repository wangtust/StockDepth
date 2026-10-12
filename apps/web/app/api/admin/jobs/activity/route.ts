import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requirePlatformAdminForApi } from '@/lib/auth/admin';
import { db } from '@/lib/db/drizzle';
import { RequestTiming } from '@/lib/http/request-timing';

export async function GET() {
  const timing = new RequestTiming();
  const admin = await timing.measure('auth', () => requirePlatformAdminForApi());
  if (admin instanceof NextResponse) return admin;
  const [activity] = await timing.measure('activity', () => db.execute(sql`
    select count(*)::int as total, max(updated_at) as updated_at,
      count(*) filter (where status in ('queued', 'running'))::int as active from analysis_jobs
  `));
  return NextResponse.json(activity, { headers: timing.headers() });
}
