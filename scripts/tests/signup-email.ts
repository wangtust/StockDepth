// Isolated schema; fake mail transport; no real recipients or account changes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../../apps/web/node_modules/dotenv';
import postgres from '../../apps/web/node_modules/postgres';
config({path:'.env'});
async function main() {
  const admin=postgres(process.env.POSTGRES_URL!,{max:1});
  const schema=`signup_test_${randomUUID().replaceAll('-','')}`;
  let client: ReturnType<typeof postgres> | undefined;
  try {
    await admin`create schema ${admin(schema)}`;
    for (const table of ['signup_email_limits','signup_email_verifications','users']) await admin`create table ${admin(schema)}.${admin(table)} (like public.${admin(table)} including all)`;
    const url=new URL(process.env.POSTGRES_URL!);url.searchParams.set('search_path',schema);process.env.POSTGRES_URL=url.toString();process.env.AUTH_SECRET='test-only-signup-secret';
    const database=await import('../../apps/web/lib/db/drizzle');client=database.client;const {db}=database;
    assert.equal((await client`select current_schema() as name`)[0].name,schema);
    const {issueSignupCode,consumeSignupCode,signupCodeHash}=await import('../../apps/web/lib/auth/signup-email');
    const {signupEmailVerifications:codes,signupEmailLimits:limits,users}=await import('../../apps/web/lib/db/schema');
    const {eq}=await import('../../apps/web/node_modules/drizzle-orm');
    let sent='';let sends=0;const mail=async (_email:string,code:string)=>{sent=code;sends++;};
    const email='signup-fixture@example.test';
    assert.ok((await issueSignupCode(email,'fixture',mail)).success);assert.match(sent,/^\d{6}$/);
    const [stored]=await db.select().from(codes).where(eq(codes.email,email));
    assert.notEqual(stored.codeHash,sent);assert.equal(stored.codeHash,signupCodeHash(email,sent));
    assert.ok((await issueSignupCode(email,'fixture',mail)).error);assert.equal(sends,1);
    assert.ok(await db.transaction(tx=>consumeSignupCode(tx,'different@example.test',sent)));
    const bad=sent==='000000'?'000001':'000000';
    assert.ok(await db.transaction(tx=>consumeSignupCode(tx,email,bad)));
    assert.equal((await db.select().from(codes).where(eq(codes.email,email)))[0].attempts,1);
    await assert.rejects(db.transaction(async tx=>{assert.equal(await consumeSignupCode(tx,email,sent),null);throw new Error('simulate failed account creation');}));
    assert.equal((await db.select().from(codes).where(eq(codes.email,email))).length,1,'rollback retains valid code');
    const results=await Promise.all([db.transaction(tx=>consumeSignupCode(tx,email,sent)),db.transaction(tx=>consumeSignupCode(tx,email,sent))]);
    assert.equal(results.filter(result=>result===null).length,1,'exactly one concurrent consumer succeeds');
    await db.delete(limits);
    const parallel=await Promise.all([issueSignupCode(email,'fixture',mail),issueSignupCode(email,'fixture',mail)]);
    assert.equal(parallel.filter(result=>result.success).length,1,'exactly one concurrent send');
    const fresh=sent;
    for(let i=0;i<5;i++) assert.ok(await db.transaction(tx=>consumeSignupCode(tx,email,fresh==='000000'?'000001':'000000')));
    assert.ok(await db.transaction(tx=>consumeSignupCode(tx,email,fresh)),'locked out after five failures');
    await db.delete(limits);
    assert.ok((await issueSignupCode(email,'fixture',mail)).success);
    await db.update(codes).set({expiresAt:new Date(Date.now()-1000)}).where(eq(codes.email,email));
    assert.ok(await db.transaction(tx=>consumeSignupCode(tx,email,sent)),'expired code rejected');
    await db.delete(limits);
    const failed=await issueSignupCode(email,'fixture',async()=>{throw new Error('fake SMTP failure');});assert.ok(failed.error);
    assert.equal((await db.select().from(codes).where(eq(codes.email,email))).length,0,'failed delivery invalidates code');
    await db.delete(limits);await issueSignupCode(email,'fixture',mail);
    await db.transaction(async tx=>{assert.equal(await consumeSignupCode(tx,email,sent),null);await tx.insert(users).values({id:123,email,passwordHash:'test-fixture',inviteCode:'ZZZZZZ'});});
    assert.equal((await db.select().from(users)).length,1);assert.equal((await db.select().from(codes)).length,0);
    await db.delete(limits);
    let hourlySends=0;
    for(let i=0;i<5;i++) {
      if(i) await db.update(limits).set({lastSentAt:new Date(Date.now()-61000)});
      assert.ok((await issueSignupCode('hourly@example.test','hourly',async()=>{hourlySends++;})).success);
    }
    await db.update(limits).set({lastSentAt:new Date(Date.now()-61000)});
    assert.ok((await issueSignupCode('hourly@example.test','hourly',async()=>{hourlySends++;})).error);
    assert.equal(hourlySends,5,'hourly mailbox limit');
    await db.update(limits).set({resetAt:new Date(Date.now()-1000),lastSentAt:new Date(Date.now()-61000)});
    assert.ok((await issueSignupCode('hourly@example.test','hourly',async()=>{})).success,'hourly counter resets');
    await db.delete(limits);
    await db.insert(limits).values({scope:`ip:${signupCodeHash('blocked-client','rate')}`,count:20,lastSentAt:new Date(),resetAt:new Date(Date.now()+3600000)});
    assert.ok((await issueSignupCode('blocked@example.test','blocked-client',async()=>{throw new Error('must not send');})).error);
    await db.delete(limits);
    await db.insert(limits).values({scope:'global',count:100,lastSentAt:new Date(),resetAt:new Date(Date.now()+3600000)});
    assert.ok((await issueSignupCode('global@example.test','new-client',async()=>{throw new Error('must not send');})).error);
    console.log('PASS: hashed codes, mailbox binding, cooldown and hourly limits, durable failures, expiry, attempt lockout, rollback, concurrent issue/consume, failed delivery, atomic account creation. No email sent.');
  } finally {
    if(client)await client.end();await admin`drop schema if exists ${admin(schema)} cascade`;await admin.end();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
