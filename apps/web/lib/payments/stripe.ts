import { mutateCredits } from '@/lib/credits/ledger';
import Stripe from 'stripe';
import { redirect } from 'next/navigation';
import { User, billingAccounts, users } from '@/lib/db/schema';
import {
  getUserByStripeCustomerId,
  getUser,
  updateUserSubscription
} from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { eq } from 'drizzle-orm';
import { getCreditPack } from '@/lib/payments/credit-packs';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const fallbackProducts = [
  {
    id: 'credits_fallback',
    name: 'Analysis Credits',
    description: '$1 per analysis credit',
    defaultPriceId: 'credits_one_usd'
  }
];

const fallbackPrices = [
  {
    id: 'credits_one_usd',
    productId: 'credits_fallback',
    unitAmount: 100,
    currency: 'usd',
    interval: null,
    trialPeriodDays: 0
  }
];

export function isStripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY;
  return Boolean(key && key.startsWith('sk_') && !key.includes('placeholder'));
}

export function getAppBaseUrl() {
  return (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function createCheckoutSession({
  user,
  packId
}: {
  user: User | null;
  packId: string;
}) {
  const pack = getCreditPack(packId);

  if (!isStripeConfigured() || !pack) {
    redirect('/pricing');
  }

  const currentUser = user || (await getUser());

  if (!currentUser) {
    redirect(`/sign-up?redirect=checkout&packId=${pack.id}`);
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: pack.amountUsd * 100,
          product_data: {
            name: `StockDepth ${pack.credits} Credit Pack`,
            description: `${pack.credits} analysis credits`
          }
        },
        quantity: 1
      }
    ],
    mode: 'payment',
    success_url: `${getAppBaseUrl()}/api/stripe/checkout?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getAppBaseUrl()}/pricing`,
    customer: currentUser.stripeCustomerId || undefined,
    client_reference_id: currentUser.id.toString(),
    allow_promotion_codes: true,
    metadata: {
      type: 'credit_purchase',
      packId: pack.id,
      credits: String(pack.credits),
      amountUsd: String(pack.amountUsd),
      userId: String(currentUser.id)
    }
  });

  redirect(session.url!);
}

export async function applyCreditPurchaseFromCheckoutSession(
  session: Stripe.Checkout.Session
) {
  if (session.payment_status !== 'paid') {
    return;
  }

  const credits = Number(session.metadata?.credits || 0);
  const userId = Number(session.metadata?.userId || session.client_reference_id || 0);

  if (!Number.isInteger(credits) || credits <= 0 || !userId) {
    throw new Error('Invalid credit purchase metadata.');
  }

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;

  await db.transaction(async (tx) => {
    const result = await mutateCredits(tx, {userId,amount:credits,reason:'stripe_credit_purchase',
      operationKey:`stripe-checkout:${session.id}`,stripeCheckoutSessionId:session.id});
    if (!result.applied) return;
    const fields = { ...(customerId ? {stripeCustomerId:customerId} : {}), planName:'Credit Pack', subscriptionStatus:'credits',updatedAt:new Date() };
    await tx.update(billingAccounts).set(fields).where(eq(billingAccounts.userId,userId));
    await tx.update(users).set(fields).where(eq(users.id,userId));
  });
}

export async function createCustomerPortalSession(user: User) {
  if (!isStripeConfigured()) {
    redirect('/pricing');
  }

  if (!user.stripeCustomerId || !user.stripeProductId) {
    redirect('/pricing');
  }

  let configuration: Stripe.BillingPortal.Configuration;
  const configurations = await stripe.billingPortal.configurations.list();

  if (configurations.data.length > 0) {
    configuration = configurations.data[0];
  } else {
    const product = await stripe.products.retrieve(user.stripeProductId);
    if (!product.active) {
      throw new Error("Account's product is not active in Stripe");
    }

    const prices = await stripe.prices.list({
      product: product.id,
      active: true
    });
    if (prices.data.length === 0) {
      throw new Error("No active prices found for the account's product");
    }

    configuration = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: 'Manage your subscription'
      },
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price', 'quantity', 'promotion_code'],
          proration_behavior: 'create_prorations',
          products: [
            {
              product: product.id,
              prices: prices.data.map((price) => price.id)
            }
          ]
        },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          cancellation_reason: {
            enabled: true,
            options: [
              'too_expensive',
              'missing_features',
              'switched_service',
              'unused',
              'other'
            ]
          }
        },
        payment_method_update: {
          enabled: true
        }
      }
    });
  }

  return stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${getAppBaseUrl()}/dashboard`,
    configuration: configuration.id
  });
}

export async function handleSubscriptionChange(
  subscription: Stripe.Subscription
) {
  const customerId = subscription.customer as string;
  const subscriptionId = subscription.id;
  const status = subscription.status;

  const user = await getUserByStripeCustomerId(customerId);

  if (!user) {
    console.error('User not found for Stripe customer:', customerId);
    return;
  }

  if (status === 'active' || status === 'trialing') {
    const plan = subscription.items.data[0]?.plan;
    await updateUserSubscription(user.id, {
      stripeSubscriptionId: subscriptionId,
      stripeProductId: plan?.product as string,
      planName: (plan?.product as Stripe.Product).name,
      subscriptionStatus: status
    });
  } else if (status === 'canceled' || status === 'unpaid') {
    await updateUserSubscription(user.id, {
      stripeSubscriptionId: null,
      stripeProductId: null,
      planName: null,
      subscriptionStatus: status
    });
  }
}

export async function getStripePrices() {
  if (!isStripeConfigured()) {
    return fallbackPrices;
  }

  const prices = await stripe.prices.list({
    expand: ['data.product'],
    active: true,
    type: 'one_time'
  });

  return prices.data.map((price) => ({
    id: price.id,
    productId:
      typeof price.product === 'string' ? price.product : price.product.id,
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval,
    trialPeriodDays: price.recurring?.trial_period_days
  }));
}

export async function getStripeProducts() {
  if (!isStripeConfigured()) {
    return fallbackProducts;
  }

  const products = await stripe.products.list({
    active: true,
    expand: ['data.default_price']
  });

  return products.data.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    defaultPriceId:
      typeof product.default_price === 'string'
        ? product.default_price
        : product.default_price?.id
  }));
}
