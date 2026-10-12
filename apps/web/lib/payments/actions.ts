'use server';

import { redirect } from 'next/navigation';
import { createCheckoutSession, createCustomerPortalSession } from './stripe';
import { withUser } from '@/lib/auth/middleware';

export const checkoutAction = withUser(async (formData, user) => {
  const packId = String(formData.get('packId') || '');
  await createCheckoutSession({ user, packId });
});

export const customerPortalAction = withUser(async (_, user) => {
  const portalSession = await createCustomerPortalSession(user);
  redirect(portalSession.url);
});
