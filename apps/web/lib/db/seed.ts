import { recordInitialCreditGrant } from '../credits/initial-grant';
import { eq } from 'drizzle-orm';
import { isStripeConfigured, stripe } from '../payments/stripe';
import { db } from './drizzle';
import { users } from './schema';
import { hashPassword } from '@/lib/auth/session';

async function createStripeProducts() {
  if (!isStripeConfigured()) {
    console.log('Skipping Stripe seed because STRIPE_SECRET_KEY is not configured.');
    return;
  }

  console.log('Creating Stripe products and prices...');

  const baseProduct = await stripe.products.create({
    name: 'Base',
    description: 'Base subscription plan',
  });

  await stripe.prices.create({
    product: baseProduct.id,
    unit_amount: 800, // $8 in cents
    currency: 'usd',
    recurring: {
      interval: 'month',
      trial_period_days: 7,
    },
  });

  const plusProduct = await stripe.products.create({
    name: 'Plus',
    description: 'Plus subscription plan',
  });

  await stripe.prices.create({
    product: plusProduct.id,
    unit_amount: 1200, // $12 in cents
    currency: 'usd',
    recurring: {
      interval: 'month',
      trial_period_days: 7,
    },
  });

  console.log('Stripe products and prices created successfully.');
}

async function seed() {
  const email = 'test@test.com';
  const password = 'admin123';
  const passwordHash = await hashPassword(password);

  const [existingUser] = await db.select().from(users).where(eq(users.email, email));

  if (existingUser) {
    console.log('Initial user already exists.');
    await createStripeProducts();
    return;
  }

  await db.transaction(async tx => {
    const [created] = await tx
    .insert(users)
    .values([
      {
        email: email,
        passwordHash: passwordHash,
        inviteCode: 'AAAAAA',
        role: 'super_admin',
        analysisCredits: 0,
      },
    ])
    .returning();
    await recordInitialCreditGrant(tx,created,'seed_initial_grant');
  });

  console.log('Initial user created.');

  await createStripeProducts();
}

seed()
  .catch((error) => {
    console.error('Seed process failed:', error);
    process.exit(1);
  })
  .finally(() => {
    console.log('Seed process finished. Exiting...');
    process.exit(0);
  });
