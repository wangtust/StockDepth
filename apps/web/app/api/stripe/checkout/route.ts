import { setSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import {
  applyCreditPurchaseFromCheckoutSession,
  getAppBaseUrl,
  stripe
} from '@/lib/payments/stripe';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.redirect(new URL('/pricing', getAppBaseUrl()));
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer'],
    });

    await applyCreditPurchaseFromCheckoutSession(session);

    const userId = session.client_reference_id;
    if (!userId) {
      throw new Error("No user ID found in session's client_reference_id.");
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, Number(userId)))
      .limit(1);

    if (user.length === 0) {
      throw new Error('User not found in database.');
    }

    await setSession(user[0]);
    return NextResponse.redirect(new URL('/dashboard/analysis?credits=added', getAppBaseUrl()));
  } catch (error) {
    console.error('Error handling successful checkout:', error);
    return NextResponse.redirect(new URL('/pricing?checkout=error', getAppBaseUrl()));
  }
}
