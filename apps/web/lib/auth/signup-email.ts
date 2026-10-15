import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { signupEmailLimits, signupEmailVerifications } from '../db/schema';

export function signupCodeHash(email: string, code: string) {
  if (!process.env.AUTH_SECRET) throw new Error('Email verification unavailable');
  return createHmac('sha256', process.env.AUTH_SECRET).update(`signup:${email}:${code}`).digest('hex');
}
async function sendVerificationEmail(email: string, code: string) {
  if (!process.env.EMAIL_SENDER || !process.env.SMTP_AUTH_CODE) throw new Error('SMTP unavailable');
  const python = process.env.STOCKDEPTH_RUNTIME_BIN ? path.join(process.env.STOCKDEPTH_RUNTIME_BIN, 'python') : 'python3';
  const script = path.resolve(process.cwd(), process.cwd().endsWith('/apps/web') ? '../../scripts/send-verification-email.py' : 'scripts/send-verification-email.py');
  await new Promise<void>((resolve, reject) => {
    const child = execFile(python, [script], {timeout: 25000, maxBuffer: 1024}, error => error ? reject(new Error('SMTP delivery failed')) : resolve());
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({email, code}));
  });
}

export async function issueSignupCode(email: string, clientScope: string, send = sendVerificationEmail) {
  const now = new Date();
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = signupCodeHash(email, code);
  const scopes = [
    {scope: `email:${signupCodeHash(email, 'rate')}`, limit: 5, cooldown: true},
    {scope: `ip:${signupCodeHash(clientScope, 'rate')}`, limit: 20, cooldown: false},
    {scope: 'global', limit: 100, cooldown: false},
  ].sort((a,b) => a.scope.localeCompare(b.scope));
  const reserved = await db.transaction(async tx => {
    for (const scope of scopes) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope.scope}, 781))`);
    for (const scope of scopes) {
      const [row] = await tx.select().from(signupEmailLimits).where(eq(signupEmailLimits.scope,scope.scope));
      if (row && ((row.resetAt > now && row.count >= scope.limit) || (scope.cooldown && now.getTime()-row.lastSentAt.getTime()<60000))) return false;
    }
    // Prune expired records in bounded batches; active rate counters are retained.
    await tx.execute(sql`delete from signup_email_verifications where email in (select email from signup_email_verifications where expires_at < now() limit 200)`);
    await tx.execute(sql`delete from signup_email_limits where scope in (select scope from signup_email_limits where reset_at < now() limit 200)`);
    for (const scope of scopes) {
      await tx.insert(signupEmailLimits).values({scope:scope.scope,count:1,resetAt:new Date(now.getTime()+3600000),lastSentAt:now})
        .onConflictDoUpdate({target:signupEmailLimits.scope,set:{count:sql`case when ${signupEmailLimits.resetAt} <= now() then 1 else ${signupEmailLimits.count} + 1 end`,resetAt:sql`case when ${signupEmailLimits.resetAt} <= now() then now() + interval '1 hour' else ${signupEmailLimits.resetAt} end`,lastSentAt:now}});
    }
    await tx.insert(signupEmailVerifications).values({email,codeHash,attempts:0,expiresAt:new Date(now.getTime()+600000)})
      .onConflictDoUpdate({target:signupEmailVerifications.email,set:{codeHash,attempts:0,expiresAt:new Date(now.getTime()+600000)}});
    return true;
  });
  if (!reserved) return {error:'Please wait 60 seconds before resending. Hourly email limits also apply.', rateLimited:true};
  try { await send(email, code); }
  catch {
    await db.delete(signupEmailVerifications).where(and(eq(signupEmailVerifications.email,email),eq(signupEmailVerifications.codeHash,codeHash)));
    return {error:'Unable to send verification email. Please try again later.'};
  }
  return {success:'Verification code sent. Check your inbox and spam folder. It expires in 10 minutes.'};
}

type VerificationWriter = Pick<typeof db, 'select' | 'update' | 'delete'>;
// Call inside the account-creation transaction. Returning an error commits the
// failed-attempt counter; successful consumption rolls back if account creation fails.
export async function consumeSignupCode(tx: VerificationWriter, email: string, code: string) {
  const [row] = await tx.select().from(signupEmailVerifications).where(eq(signupEmailVerifications.email,email)).for('update');
  if (!row || row.expiresAt <= new Date() || row.attempts >= 5) return 'Invalid or expired code. Request a new code.';
  await tx.update(signupEmailVerifications).set({attempts:row.attempts+1}).where(eq(signupEmailVerifications.email,email));
  const actual=Buffer.from(signupCodeHash(email,code),'hex'), expected=Buffer.from(row.codeHash,'hex');
  if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) return 'Incorrect verification code.';
  await tx.delete(signupEmailVerifications).where(eq(signupEmailVerifications.email,email));
  return null;
}
