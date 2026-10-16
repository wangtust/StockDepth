import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { billingAccounts, creditTransactions, users } from '@/lib/db/schema';

export type BillingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// All callers that touch multiple accounts must acquire this complete set first.
export async function lockBillingAccounts(tx: BillingTransaction, userIds: number[]) {
  const ids = [...new Set(userIds)].sort((a, b) => a - b);
  return tx.select().from(billingAccounts).where(inArray(billingAccounts.userId, ids))
    .orderBy(billingAccounts.userId).for('update');
}

export class InsufficientCreditsError extends Error {}

export async function mutateCredits(tx: BillingTransaction, input: {
  userId: number; amount: number; reason: string; operationKey: string;
  jobId?: number; stripeCheckoutSessionId?: string; metadata?: Record<string, unknown>;
}) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new Error('Invalid credit amount.');
  const [account] = await lockBillingAccounts(tx, [input.userId]);
  if (!account) throw new Error('Billing account not initialized.');
  const operation = and(eq(creditTransactions.userId,input.userId),eq(creditTransactions.operationKey,input.operationKey));
  const [existing] = await tx.select().from(creditTransactions)
    .where(input.stripeCheckoutSessionId ? or(operation,eq(creditTransactions.stripeCheckoutSessionId,input.stripeCheckoutSessionId)) : operation).limit(1);
  if (existing) {
    if (existing.userId !== input.userId || existing.amount !== input.amount || existing.reason !== input.reason ||
        existing.jobId !== (input.jobId ?? null) || existing.stripeCheckoutSessionId !== (input.stripeCheckoutSessionId ?? null)) {
      throw new Error('Credit operation key conflicts with an existing operation.');
    }
    return { balance: account.analysisCredits, applied: false };
  }
  const balance = account.analysisCredits + input.amount;
  if (balance < 0) throw new InsufficientCreditsError('Not enough analysis credits.');
  if (!Number.isSafeInteger(balance) || balance > 2147483647) throw new Error('Credit balance exceeds allowed range.');
  const sequence = account.ledgerSequence + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error('Ledger sequence exceeds allowed range.');
  await tx.insert(creditTransactions).values({ ...input, operationKey: input.operationKey,
    ledgerSequence: sequence, balanceAfter: balance, metadata: input.metadata ?? {} });
  await tx.update(billingAccounts).set({ analysisCredits: balance, ledgerSequence: sequence, updatedAt: new Date() })
    .where(eq(billingAccounts.userId, input.userId));
  await tx.update(users).set({ analysisCredits: balance, updatedAt: new Date() }).where(eq(users.id, input.userId));
  return { balance, applied: true };
}
