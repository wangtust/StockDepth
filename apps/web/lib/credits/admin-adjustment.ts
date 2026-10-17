import { randomUUID } from 'node:crypto';
import { lockBillingAccounts, mutateCredits } from './ledger';
import {db} from '../db/drizzle';
import {adminAuditLogs} from '../db/schema';

export async function adjustCreditBalance(adminUserId:number,userId:number,amount:number,note?:string) {
  if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>100000)return {error:'The credit adjustment must be a nonzero integer from -100000 to 100000.'};
  return db.transaction(async tx=>{
    const [account]=await lockBillingAccounts(tx,[userId]);
    const user=account && {id:account.userId,credits:account.analysisCredits};
    if(!user)return {error:'User not found.'};
    const next=user.credits+amount;
    if(next<0)return {error:'The user has insufficient credits. No credits were deducted.'};
    if(next>2147483647)return {error:'The resulting credit balance exceeds the allowed range.'};
    const actualAmount=next-user.credits;
    await mutateCredits(tx,{userId,amount:actualAmount,reason:'admin_credit_adjustment',operationKey:`admin-adjustment:${randomUUID()}`,metadata:{adminUserId,note}});
    await tx.insert(adminAuditLogs).values({adminUserId,action:'user.credits.adjust',targetType:'user',targetId:userId,
      metadata:JSON.stringify({amount:actualAmount,requestedAmount:amount,actualAmount,previousCredits:user.credits,resultingCredits:next,note})});
    return {success:'Credits updated.'};
  });
}
