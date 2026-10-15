// Read-only local browser measurement. Does not print tokens, users or page contents.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(root + '/apps/web/node_modules/dotenv').config({path: root + '/.env'});
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, {max: 1});
const {chromium} = require(root + '/apps/web/node_modules/playwright');
const base = process.env.STOCKDEPTH_DIAGNOSTIC_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local loopback only');
const output = process.argv[2];
(async () => {
  let browser;
  try {
    const [user] = await sql`select id from users where status='active' and deleted_at is null order by (role in ('admin','super_admin')) desc,id limit 1`;
    if (!user) throw Error('A local active account is required for read-only navigation measurements');
    const {SignJWT} = await import(root + '/apps/web/node_modules/jose/dist/webapi/index.js');
    const token = await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()})
      .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    const rows = [];
    for (const delay of [0, 350]) {
      const context = await browser.newContext();
      await context.addCookies([{name:'session',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error.message).split('\n')[0].slice(0,180)));
      await page.route('**/dashboard/analysis?*', async route => {
        if (route.request().url().includes('_rsc=') && delay) await new Promise(resolve => setTimeout(resolve, delay));
        await route.continue();
      });
      await page.goto(base + '/dashboard/general');
      await page.getByRole('heading',{name:'General Settings',exact:true}).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        window.navigationMeasurement = {};
        document.addEventListener('click', event => {
          if (!event.target.closest('a[href="/dashboard/analysis"]')) return;
          const result = window.navigationMeasurement = {started:performance.now(),feedback:null};
          const observer = new MutationObserver(() => {
            if (result.feedback === null && document.querySelector('[data-navigation-pending], section[aria-busy="true"]')) result.feedback = performance.now() - result.started;
          });
          observer.observe(document.body,{subtree:true,childList:true,attributes:true});
          setTimeout(() => observer.disconnect(),10000);
        }, {capture:true,once:true});
      });
      await page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('link',{name:'Analysis',exact:true}).click();
      await page.getByRole('heading',{name:'Analysis Queue',exact:true}).waitFor();
      const measurement = await page.evaluate(() => ({feedbackMs:window.navigationMeasurement.feedback,
        contentMs:performance.now()-window.navigationMeasurement.started,
        nestedInteractive:document.querySelectorAll('nav a button, nav button a').length,
        pendingAfterNavigation:document.querySelectorAll('[data-navigation-pending]').length}));
      measurement.browserErrors = errors;
      rows.push({route:'/dashboard/general -> /dashboard/analysis',simulatedRscDelayMs:delay,...measurement});
      await context.close();
    }
    const result = {scope:'Local browser, read-only existing account; one sample per condition, not a production SLA',rows};
    if (output) {fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));}
    console.log(JSON.stringify(result));
    if (rows.some(row => row.browserErrors.length || row.nestedInteractive || row.pendingAfterNavigation)) {
      throw Error('Browser navigation regression detected');
    }
  } finally {await browser?.close();await sql.end();}
})().catch(error => {console.error('Read-only navigation measurement failed:', error.name, String(error.message).split('\n')[0].slice(0,160));process.exitCode=1;});
