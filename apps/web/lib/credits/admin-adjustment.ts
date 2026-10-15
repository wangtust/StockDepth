import {eq} from 'drizzle-orm';
import {db} from '../db/drizzle';
import {users,creditTransactions,adminAuditLogs} from '../db/schema';

export async function adjustCreditBalance(adminUserId:number,userId:number,amount:number,note?:string) {
  if(!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>100000)return {error:'调整额度须为非零整数，范围为 -100000 至 100000。'};
  return db.transaction(async tx=>{
    const [user]=await tx.select({id:users.id,credits:users.analysisCredits}).from(users).where(eq(users.id,userId)).for('update');
    if(!user)return {error:'User not found.'};
    const next=user.credits+amount;
    if(next<0)return {error:'用户剩余额度不足，未执行扣减。'};
    if(next>2147483647)return {error:'调整后额度超出允许范围。'};
    const actualAmount=next-user.credits;
    await tx.update(users).set({analysisCredits:next,updatedAt:new Date()}).where(eq(users.id,userId));
    await tx.insert(creditTransactions).values({userId,amount:actualAmount,reason:'admin_credit_adjustment'});
    await tx.insert(adminAuditLogs).values({adminUserId,action:'user.credits.adjust',targetType:'user',targetId:userId,
      metadata:JSON.stringify({amount:actualAmount,requestedAmount:amount,actualAmount,previousCredits:user.credits,resultingCredits:next,note})});
    return {success:'Credits updated.'};
  });
}
