const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'../..');
const esbuild=require(root+'/apps/web/node_modules/esbuild');
const {chromium}=require(root+'/apps/web/node_modules/playwright');
(async()=>{
 const {outputFiles}=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {StockDecisionHistory} from './components/stock-decision-history';createRoot(document.getElementById('root')).render(<StockDecisionHistory id="1"/>);`,resolveDir:root+'/apps/web',loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env':'{}'},tsconfig:root+'/apps/web/tsconfig.json'});
 const css=fs.readdirSync(root+'/apps/web/.next/static/css').filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync(root+'/apps/web/.next/static/css/'+name,'utf8')).join('\n');
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({timezoneId:'Asia/Shanghai'}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const decisions=[
    {jobId:1,date:'2026-10-10',analysisDate:'2026-10-10',action:'buy',summary:'Buy summary',extractionStatus:'succeeded',completedAt:'2026-10-11T02:00:00Z',model:'fixture'},
    {jobId:2,date:'2026-10-12',analysisDate:'2026-10-12',action:'sell',summary:'Sell summary',extractionStatus:'succeeded'},
    {jobId:3,date:'2026-10-13',analysisDate:'2026-10-13',action:'hold',summary:'Hold summary',extractionStatus:'succeeded'},
    {jobId:4,date:'2026-10-14',analysisDate:'2026-10-14',action:null,summary:'Rating: Overweight',extractionStatus:'unrecognized'},
    {jobId:5,date:'2026-10-15',analysisDate:'2026-10-15',action:'buy',extractionStatus:'succeeded'}
  ];
  const prices=[{date:'2026-10-12',close:'100'},{date:'2026-10-13',close:'102'},{date:'2026-10-14',close:'101'}];
  await page.route('http://decisions.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:outputFiles[0].text});
    if(url.pathname.endsWith('/decisions'))return route.fulfill({json:{prices,decisions,source:'fixture',currency:'USD',timezone:'America/New_York'}});
    if(url.pathname==='/api/analysis/jobs/1')return route.fulfill({json:{report:{title:'Final decision',content:'**Rating**: Buy'}}});
    return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style><div id="root"></div><script src="/bundle.js"></script>'});
  });
  await page.goto('http://decisions.test/');
  await page.getByText('5 reports · 1 unrecognized / pending').waitFor();
  assert.equal(await page.locator('svg [role="button"]').count(),3,'weekend maps to Monday, missing session has no marker');
  assert.equal(await page.locator('tbody tr').count(),5,'all same-day reports preserved');
  await page.getByLabel('Decision',{exact:true}).selectOption('sell');
  assert.equal(await page.locator('tbody tr').count(),1);
  assert.equal(await page.locator('svg [role="button"]').count(),1);
  await page.getByLabel('Decision',{exact:true}).selectOption('all');
  await page.getByRole('button',{name:'View #1',exact:true}).click();
  await page.getByRole('dialog').getByText('Final decision',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close report #1'}).press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no mobile page overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS: chart markers, weekend alignment, same-day decisions, unpriced records, filtering, report viewer, mobile width, Shanghai timezone.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
