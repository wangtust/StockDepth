import {db} from '../db/drizzle';
import {creditTransactions} from '../db/schema';
export async function recordInitialCreditGrant(tx:Pick<typeof db,'insert'>,user:{id:number;analysisCredits:number},reason:'signup_grant'|'seed_initial_grant') {
  await tx.insert(creditTransactions).values({userId:user.id,amount:user.analysisCredits,reason});
}
