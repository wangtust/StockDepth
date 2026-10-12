import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import { instruments } from '@/lib/db/schema';
export async function PATCH(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const user = await getUser();
  if (!user) return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  if (!['admin', 'super_admin'].includes(user.role)) return NextResponse.json({error: 'Forbidden'}, {status: 403});
  const id = Number((await params).id);
  const body = z.object({enabled: z.boolean()}).strict().safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !body.success)
    return NextResponse.json({error: 'Invalid request'}, {status: 400});
  const item = await db.transaction(async tx => {
    const [current] = await tx.select().from(instruments).where(eq(instruments.id, id)).for('update');
    if (!current) return null;
    const [updated] = await tx.update(instruments).set({syncEnabled: body.data.enabled}).where(eq(instruments.id, id))
      .returning({id: instruments.id, enabled: instruments.syncEnabled});
    return updated;
  });
  return NextResponse.json(item ?? {error: 'Not found'}, {status: item ? 200 : 404});
}
