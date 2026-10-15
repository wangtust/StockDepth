// Real local registration page; mail endpoint intercepted, no email or account created.
const assert=require('node:assert/strict');
const path=require('node:path');
const modules=path.resolve(__dirname,'../../apps/web/node_modules');
const {chromium}=require(modules+'/playwright');
require(modules+'/dotenv').config({path:path.resolve(__dirname,'../../.env'),quiet:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 const sql=require(modules+'/postgres')(process.env.POSTGRES_URL,{max:1});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let sends=0;
  await page.route('**/api/auth/signup-code',route=>{sends++;return route.fulfill({json:{success:'Verification code sent. Check your inbox and spam folder. It expires in 10 minutes.'}});});
  await page.goto('http://127.0.0.1:3000/sign-up');
  await page.getByLabel('Email',{exact:true}).fill('verification-fixture@example.test');
  await page.getByLabel('Password',{exact:true}).fill('FixturePassword123');
  await page.getByRole('button',{name:'Send code',exact:true}).click();
  await page.getByText(/Verification code sent\./).waitFor();assert.equal(sends,1);
  assert.ok(await page.getByRole('button',{name:/Resend in/}).isDisabled());
  await page.getByLabel('Email verification code',{exact:true}).evaluate(el=>el.required=false);
  await page.getByRole('button',{name:'Sign up',exact:true}).click();
  await page.getByText('Enter the 6-digit email verification code.',{exact:true}).waitFor();
  await page.getByLabel('Email',{exact:true}).fill('verification-fixture@example.test');
  await page.getByLabel('Password',{exact:true}).fill('FixturePassword123');
  await page.getByLabel('Email verification code',{exact:true}).fill('000000');
  await page.getByRole('button',{name:'Sign up',exact:true}).click();
  await page.getByText('Invalid or expired code. Request a new code.',{exact:true}).waitFor();
  assert.equal((await sql`select count(*)::int as count from users where email='verification-fixture@example.test'`)[0].count,0);
  await page.goto('http://127.0.0.1:3000/sign-in');assert.equal(await page.getByLabel('Email verification code',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  const base='http://127.0.0.1:3000/api/auth/signup-code';
  assert.equal((await fetch(base,{method:'POST',headers:{origin:'https://invalid.example','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers:{origin:'http://127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify({email:'invalid'})})).status,400);
  console.log('PASS: send-code UI, cooldown, server rejects missing/invalid code, no unverified account created, sign-in unaffected, origin and email validation. No email sent.');
 }finally{await browser.close();await sql.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
