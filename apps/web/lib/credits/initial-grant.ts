import { mutateCredits, type BillingTransaction } from './ledger';
export async function recordInitialCreditGrant(tx: BillingTransaction, user: {id:number}, reason:'signup_grant'|'seed_initial_grant') {
  return mutateCredits(tx, { userId: user.id, amount: 10, reason, operationKey: `initial-grant:${user.id}` });
}
