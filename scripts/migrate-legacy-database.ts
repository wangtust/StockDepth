// Explicit legacy import. Source is read-only; backups and a restored rehearsal
// database are required before the live transaction. Never prints row payloads.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import postgres from '../apps/web/node_modules/postgres';
import {config} from '../apps/web/node_modules/dotenv';
import {decryptModelKey,encryptModelKey} from '../apps/web/lib/security/model-key';

config({path:'.env',quiet:true});
type Row = Record<string,any>;
type Snapshot = {rows:Record<string,Row[]>;counts:Record<string,number>;digest:string};
const order=['users','llm_model_configs','instruments','instrument_sources','price_snapshots','daily_prices',
  'market_sync_state','market_sync_runs','analysis_pricing','analysis_worker_settings','analysis_jobs',
  'watchlist_items','paper_portfolios','paper_positions','paper_analysis_runs','paper_trade_decisions',
  'paper_trades','paper_trade_requests','analysis_reports','analysis_decisions','analysis_model_calls',
  'paper_model_calls','analysis_job_resumptions','credit_transactions','activity_logs','admin_audit_logs'];
const excluded=['signup_email_verifications','signup_email_limits'];
const importerDigest=createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex');
const natural:Record<string,string[]>={users:['email'],instruments:['exchange','symbol'],instrument_sources:['vendor','vendor_symbol'],
  price_snapshots:['instrument_id','source','quoted_at','price_type'],daily_prices:['instrument_id','source','adjusted','trading_date'],
  market_sync_state:['instrument_id','category'],analysis_pricing:['depth'],analysis_worker_settings:['key'],
  analysis_jobs:['run_id'],watchlist_items:['user_id','ticker'],paper_positions:['portfolio_id','ticker'],
  paper_analysis_runs:['analysis_job_id'],paper_trade_decisions:['paper_analysis_run_id'],analysis_reports:['job_id','report_key'],
  analysis_decisions:['job_id'],analysis_model_calls:['job_id','call_id'],paper_model_calls:['paper_run_id','call_id'],
  paper_trade_requests:['user_id','portfolio_id','key']};
function canonical(v:any):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v)??'null';}
function digest(v:any){return createHash('sha256').update(canonical(v)).digest('hex');}
function connect(url:string){return postgres(url,{max:1,onnotice:()=>{},connection:{TimeZone:'UTC'},types:{rawTime:{to:25,from:[1082,1114,1184],serialize:(v:any)=>String(v),parse:(v:string)=>v}}});}
function urlFor(name:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw new Error('Invalid database identifier');const u=new URL(process.env.POSTGRES_URL!);u.pathname='/'+name;return u.toString();}
class MigrationValidationError extends Error {}
function check(ok:any,message:string):asserts ok {if(!ok)throw new MigrationValidationError(message);}
async function snapshot(client:any):Promise<Snapshot>{return client.begin('isolation level repeatable read read only',async(s:any)=>{
  const rows:Record<string,Row[]>={},counts:Record<string,number>={};
  for(const {tablename} of await s`select tablename from pg_tables where schemaname='public' order by tablename`){
    const key=tablename==='analysis_pricing'?'depth':tablename==='analysis_worker_settings'?'key':tablename==='signup_email_verifications'?'email':tablename==='signup_email_limits'?'scope':tablename==='billing_accounts'?'user_id':'id';
    rows[tablename]=await s`select * from ${s(tablename)} order by ${s(key)}`;counts[tablename]=rows[tablename].length;
  }
  return {rows,counts,digest:digest(rows)};
});}
function naturalKey(table:string,row:Row){let fields=natural[table];if(table==='credit_transactions'&&row.stripe_checkout_session_id)fields=['stripe_checkout_session_id'];if(table==='paper_trades'&&row.decision_id!=null)fields=['decision_id'];if(!fields)return null;return canonical(fields.map(k=>table==='users'?String(row[k]).trim().toLowerCase():row[k]));}
const aliases:Record<string,string>={userId:'users',user_id:'users',adminUserId:'users',admin_user_id:'users',
  jobId:'analysis_jobs',job_id:'analysis_jobs',analysisJobId:'analysis_jobs',analysis_job_id:'analysis_jobs',
  configId:'llm_model_configs',modelConfigId:'llm_model_configs',model_config_id:'llm_model_configs',quickModelConfigId:'llm_model_configs',deepModelConfigId:'llm_model_configs',
  portfolioId:'paper_portfolios',portfolio_id:'paper_portfolios',positionId:'paper_positions',position_id:'paper_positions',
  instrumentId:'instruments',instrument_id:'instruments',decisionId:'paper_trade_decisions',decision_id:'paper_trade_decisions',
  watchlistItemId:'watchlist_items',watchlist_item_id:'watchlist_items',tradeId:'paper_trades',trade_id:'paper_trades'};

async function importSnapshot(client:any,source:Snapshot,sourceName:string,targetName:string){
 return client.begin(async(tx:any)=>{
  await tx`select pg_advisory_xact_lock(739421,51)`;
  for(const table of [...order,'billing_accounts','llm_model_config_versions'].sort())await tx`lock table ${tx(table)} in share row exclusive mode`;
  const markers=await tx`select metadata from admin_audit_logs where action='database.legacy_import'`;
  for(const m of markers){const old=JSON.parse(m.metadata);if(old.sourceDatabase===sourceName){check(old.sourceDigest===source.digest,'Source changed after previous import; incremental merge needs review');return {...old,idempotent:true};}}
  const cols:Record<string,string[]>={};for(const r of await tx`select table_name,column_name from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)(cols[r.table_name]??=[]).push(r.column_name);
  const fks=await tx`select distinct c.conrelid::regclass::text as child,c.confrelid::regclass::text as parent,a.attname as column_name from pg_constraint c join lateral unnest(c.conkey,c.confkey) k(child_num,parent_num) on true join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.child_num join pg_attribute p on p.attrelid=c.confrelid and p.attnum=k.parent_num where c.contype='f' and c.connamespace='public'::regnamespace and p.attname='id'`;
  const target:Record<string,Row[]>={};for(const table of [...order,'billing_accounts','llm_model_config_versions'])target[table]=await tx`select * from ${tx(table)}`;
  const map:Record<string,Map<number,number>>={},added:Record<string,number>={},expected:Record<string,Row[]>={};
  const mergedUsers:{source:Row;target:Row}[]=[];const incompleteModels:number[]=[];const now=new Date().toISOString();let paused=0,interrupted=0;
  const id=(table:string,value:any)=>{if(value==null)return value;const found=map[table]?.get(Number(value));check(found!=null,'Missing referenced legacy identity: '+table);return found;};
  function rewrite(value:any):any {if(Array.isArray(value))return value.map(rewrite);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,aliases[k]&&v!=null&&map[aliases[k]]?.has(Number(v))?id(aliases[k],v):rewrite(v)]));}
  function references(table:string,row:Row){const r={...row};for(const fk of fks.filter((f:Row)=>f.child===table)){if(row[fk.column_name]!=null&&map[fk.parent])r[fk.column_name]=id(fk.parent,row[fk.column_name]);}
    if(['analysis_model_calls','paper_model_calls'].includes(table)&&r.model_config_id!=null)r.model_config_id=id('llm_model_configs',r.model_config_id);
    return r;
  }
  const versions=new Map<string,Row>();
  const rate=(v:any)=>v==null?null:String(v).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
  async function version(model:Row,provenance:string,when:string){
    const get=(snake:string,camel:string)=>model[snake]!==undefined?model[snake]:model[camel];
    const key=get('api_key','apiKey');check(typeof key==='string'&&key.length>0,'Model credential missing');const plaintext=decryptModelKey(key);
    const fields={provider:model.provider,base_url:get('base_url','baseUrl'),model_name:get('model_name','modelName'),
      model_options:get('model_options','modelOptions')??{},input_price:get('input_price','inputPrice')??null,
      cache_price:get('cache_price','cachePrice')??null,output_price:get('output_price','outputPrice')??null,
      price_currency:'CNY',price_unit_tokens:1000000};
    const fingerprint=digest({config_id:model.id,...fields,input_price:rate(fields.input_price),cache_price:rate(fields.cache_price),output_price:rate(fields.output_price),key:plaintext});
    if(versions.has(fingerprint))return versions.get(fingerprint)!;
    const [v]=await tx`insert into llm_model_config_versions ${tx([{config_id:model.id,version:1+Number((await tx`select coalesce(max(version),0)::int as n from llm_model_config_versions where config_id=${model.id}`)[0].n),...fields,encrypted_api_key:key.startsWith('sdkey:')?key:encryptModelKey(key),provenance,created_at:when}])} returning *`;
    versions.set(fingerprint,v);return v;
  }
  // Seed content-based reuse from existing immutable versions, without changing them.
  for(const v of target.llm_model_config_versions){versions.set(digest({config_id:v.config_id,provider:v.provider,base_url:v.base_url,model_name:v.model_name,model_options:v.model_options,input_price:rate(v.input_price),cache_price:rate(v.cache_price),output_price:rate(v.output_price),price_currency:v.price_currency,price_unit_tokens:v.price_unit_tokens,key:decryptModelKey(v.encrypted_api_key)}),v);}
  async function historical(text:string|null){if(!text)return null;const model=JSON.parse(text);check(model&&Number.isInteger(model.id),'Invalid historical model snapshot');model.id=id('llm_model_configs',model.id);model.apiKey=model.apiKey.startsWith('sdkey:')?(decryptModelKey(model.apiKey),model.apiKey):encryptModelKey(model.apiKey);delete model.currentVersionId;return model;}
  for(const table of order){
    const incoming=source.rows[table]??[];const existing=target[table];map[table]=new Map();expected[table]=[];added[table]=0;
    const byNatural=new Map(existing.map(r=>[naturalKey(table,r),r]));const occupied=new Set(existing.map(r=>r.id));let next=Math.max(0,...incoming.map(r=>r.id??0),...existing.map(r=>r.id??0))+1;
    const planned:{original:Row;row:Row;existing?:Row}[]=[];
    for(const original of incoming){const row=table==='users'?{...original}:references(table,original),key=naturalKey(table,row);const match=key==null?undefined:byNatural.get(key);
      if(original.id!=null){const mapped=match?.id??(occupied.has(original.id)?next++:original.id);map[table].set(original.id,mapped);row.id=mapped;occupied.add(mapped);}
      planned.push({original,row,existing:match});
    }
    if(table==='users'){
      check(new Set(incoming.map(r=>r.email.trim().toLowerCase())).size===incoming.length,'Case-folded legacy user identities collide');
      for(const item of planned){if(item.existing){mergedUsers.push({source:item.original,target:item.existing});const old=item.original,current=item.existing;
        const changes={name:current.name??old.name,invite_code:current.invite_code??old.invite_code,created_at:Date.parse(old.created_at)<Date.parse(current.created_at)?old.created_at:current.created_at};
        await tx`update users set ${tx(changes)} where id=${current.id}`;
      }else{item.row.referred_by_user_id=null;await tx`insert into users ${tx([item.row],Object.keys(item.row).filter(k=>cols.users.includes(k)))}`;added[table]++;}}
      for(const item of planned)if(item.original.referred_by_user_id!=null&&!item.existing?.referred_by_user_id){await tx`update users set referred_by_user_id=${id('users',item.original.referred_by_user_id)} where id=${item.row.id}`;}
      continue;
    }
    if(table==='llm_model_configs'){
      const preserveDefault=existing.some(r=>r.is_default&&!r.retired_at&&r.api_key);
      for(const item of planned){if(preserveDefault)item.row.is_default=false;delete item.row.current_version_id;await tx`insert into llm_model_configs ${tx([item.row],Object.keys(item.row).filter(k=>cols[table].includes(k)))}`;added[table]++;}
      for(const model of await tx`select * from llm_model_configs order by id`){
        if(!model.api_key){incompleteModels.push(model.id);await tx`update llm_model_configs set is_default=false,is_active=false where id=${model.id}`;continue;}
        const current=await version(model,'configured',now);const key=model.api_key.startsWith('sdkey:')?model.api_key:encryptModelKey(model.api_key);await tx`update llm_model_configs set current_version_id=${current.id},api_key=${key} where id=${model.id}`;
      }
      continue;
    }
    const inserts:Row[]=[];
    for(const item of planned){let r=item.row;const old=item.original;
      if(item.existing){
        if(['analysis_pricing','analysis_worker_settings'].includes(table))continue; // New environment settings win.
        const skip=new Set(['id','created_at','updated_at','fetched_at']);
        check(Object.keys(old).every(k=>skip.has(k)||canonical(r[k])===canonical(item.existing![k])),'Conflicting existing entity: '+table);
        continue;
      }
      if(table==='analysis_jobs'){
        const quick=await historical(old.quick_config_snapshot),deep=await historical(old.deep_config_snapshot);
        r.quick_config_snapshot=quick?JSON.stringify(quick):null;r.deep_config_snapshot=deep?JSON.stringify(deep):null;
        if(quick&&deep){const q=await version(quick,'historical_snapshot',old.created_at),d=await version(deep,'historical_snapshot',old.created_at);Object.assign(r,{quick_model_version_id:q.id,deep_model_version_id:d.id,configuration_state:'versioned',model_config_id:quick.id,quick_model_config_id:quick.id,deep_model_config_id:deep.id,quick_model:quick.modelName,deep_model:deep.modelName});}
        else Object.assign(r,{quick_model_version_id:null,deep_model_version_id:null,configuration_state:'legacy_unknown'});
        const charges=source.rows.credit_transactions.filter(c=>c.job_id===old.id&&c.amount<0&&['analysis_job_created','paper_portfolio_analysis'].includes(c.reason));r.charged_credits=charges.length?-charges.reduce((n,c)=>n+c.amount,0):null;
        if(['queued','running'].includes(old.status)){paused++;Object.assign(r,{status:'failed',external_status:'migration_paused',error_message:[old.error_message,'迁移时任务尚未结束，已暂停自动执行；请确认后手动继续。'].filter(Boolean).join('\n'),completed_at:now,updated_at:now});}
        Object.assign(r,{external_pid:null,worker_owner:null,worker_lease_until:null});
      }
      if(table==='analysis_job_resumptions'){
        const snapshots=await Promise.all(['previous_quick','previous_deep','next_quick','next_deep'].map(k=>historical(old[k+'_config_snapshot'])));
        for(let i=0;i<4;i++){const prefix=['previous_quick','previous_deep','next_quick','next_deep'][i],m=snapshots[i];r[prefix+'_config_snapshot']=m?JSON.stringify(m):null;r[prefix+'_version_id']=m?(await version(m,'historical_snapshot',old.created_at)).id:null;}
        r.configuration_state=snapshots[2]&&snapshots[3]?'versioned':'legacy_unknown';r.initiator='legacy_unknown';
      }
      if(['analysis_model_calls','paper_model_calls'].includes(table)){
        r.model_version_id=null;let pricing=null;try{pricing=JSON.parse(r.pricing_snapshot);}catch{}r.cost_currency=pricing?.currency??null;
        for(const field of ['pricing_snapshot','raw_usage'])if(r[field]){try{r[field]=JSON.stringify(rewrite(JSON.parse(r[field])));}catch{}}
        if(r.status==='running'){interrupted++;r.status='interrupted';r.ended_at=r.ended_at??now;r.cost_complete=false;}
      }
      if(table==='market_sync_state')Object.assign(r,{owner:null,lease_until:null});
      if(table==='paper_analysis_runs'){if(['queued','claimed','submitted'].includes(r.processing_state))r.processing_state=r.processing_state==='submitted'?'unknown':'failed';Object.assign(r,{worker_owner:null,worker_lease_until:null,trader_model_version_id:null});}
      if(table==='credit_transactions')Object.assign(r,{ledger_sequence:null,balance_after:null,operation_key:null,metadata:{legacySourceDatabase:sourceName,legacyTransactionId:old.id}});
      if(table==='admin_audit_logs'){
        const entity=({user:'users',llm_model_config:'llm_model_configs',analysis_job:'analysis_jobs',paper_portfolio:'paper_portfolios'} as Row)[r.target_type];if(entity&&r.target_id!=null&&map[entity].has(r.target_id))r.target_id=id(entity,r.target_id);
        try{r.metadata=JSON.stringify({...rewrite(JSON.parse(r.metadata)),legacySourceDatabase:sourceName});}catch{}
      }
      // request/result can carry IDs independent of their relational columns.
      if(table==='paper_trade_requests'){try{r.request=JSON.stringify(rewrite(JSON.parse(r.request)));}catch{}r.result=rewrite(r.result);}
      expected[table].push(r);inserts.push(r);
    }
    for(let start=0;start<inserts.length;start+=100){const part=inserts.slice(start,start+100);const keys=Object.keys(part[0]).filter(k=>cols[table].includes(k));await tx`insert into ${tx(table)} ${tx(part,keys)}`;added[table]+=part.length;}
  }
  // Reconcile only balances, not an invented historical transaction timeline.
  for(const old of source.rows.users){const userId=id('users',old.id),overlap=mergedUsers.find(m=>m.source.id===old.id);const [account]=await tx`select * from billing_accounts where user_id=${userId} for update`;
    if(!overlap){await tx`update billing_accounts set analysis_credits=${old.analysis_credits},ledger_opening_balance=${old.analysis_credits},stripe_customer_id=${old.stripe_customer_id},stripe_subscription_id=${old.stripe_subscription_id},stripe_product_id=${old.stripe_product_id},plan_name=${old.plan_name},subscription_status=${old.subscription_status},updated_at=now() where user_id=${userId}`;}
    else{
      check(account.ledger_opening_balance===0,'Existing account has a nonzero baseline; merge needs review');
      const records=await tx`select * from credit_transactions where user_id=${userId} and ledger_sequence is not null`;
      const bootstrap=records.filter((r:Row)=>r.reason==='initial_admin_grant'||r.reason==='signup_grant'||r.reason==='seed_initial_grant').reduce((n:number,r:Row)=>n+r.amount,0);
      const desired=old.analysis_credits+account.analysis_credits-bootstrap;check(desired>=0&&desired<=2147483647,'Merged balance outside supported range');
      const delta=desired-account.analysis_credits;
      if(delta){const seq=Number(account.ledger_sequence)+1;const next=Math.max(0,...(await tx`select id from credit_transactions`).map((r:Row)=>r.id))+1;await tx`insert into credit_transactions(id,user_id,amount,reason,ledger_sequence,balance_after,operation_key,metadata) values(${next},${userId},${delta},'legacy_balance_merge',${seq},${desired},${'legacy-balance:'+sourceName+':'+old.id},${tx.json({sourceDatabase:sourceName,legacyUserId:old.id})})`;added.credit_transactions++;await tx`update billing_accounts set analysis_credits=${desired},ledger_sequence=${seq},updated_at=now() where user_id=${userId}`;}
    }
  }
  // Verify reports, monetary facts and IDs with server-side exact comparisons.
  for(const table of ['analysis_reports','paper_trades','paper_positions','paper_portfolios','daily_prices','price_snapshots','analysis_model_calls','analysis_job_resumptions','credit_transactions']){
    const rows=await tx`select * from ${tx(table)}`;const actual=new Map(rows.map((r:Row)=>[r.id,r]));
    const ignore=new Set(['created_at','updated_at','quoted_at','fetched_at','started_at','ended_at']);
    for(const row of expected[table]){const found=actual.get(row.id) as Row|undefined;check(found,'Imported record missing: '+table);for(const k of Object.keys(row))if(cols[table].includes(k)&&!ignore.has(k))check(canonical(row[k])===canonical(found[k]),'Imported value mismatch: '+table+'.'+k);}
  }
  const mismatches=await tx`select b.user_id from billing_accounts b left join lateral (select coalesce(sum(amount),0) as net,max(ledger_sequence) as last from credit_transactions c where c.user_id=b.user_id and c.ledger_sequence is not null) c on true where b.analysis_credits<>b.ledger_opening_balance+c.net or b.ledger_sequence<>coalesce(c.last,0)`;check(!mismatches.length,'Account ledger reconciliation failed');
  check(!(await tx`select 1 from pg_constraint where connamespace='public'::regnamespace and not convalidated`).length,'Unvalidated constraint');
  for(const table of order){const result=await tx`select count(*)::int as n from ${tx(table)}`;check(result[0].n===target[table].length+added[table],'Unexpected imported count: '+table);}
  const report={sourceDatabase:sourceName,sourceDigest:source.digest,importerDigest,targetDatabase:targetName,importedAt:now,sourceCounts:source.counts,added,mergedUserCount:mergedUsers.length,pausedJobs:paused,interruptedCalls:interrupted,incompleteModels,excluded,idMaps:Object.fromEntries(Object.entries(map).map(([t,m])=>[t,Object.fromEntries(m)]))};
  const auditId=Math.max(0,...(await tx`select id from admin_audit_logs`).map((r:Row)=>r.id))+1;
  const actor=(await tx`select id from users where role='super_admin' and deleted_at is null order by id limit 1`)[0];check(actor,'Migration audit actor missing');
  await tx`insert into admin_audit_logs(id,admin_user_id,action,target_type,metadata) values(${auditId},${actor.id},'database.legacy_import','database',${JSON.stringify(report)})`;
  for(const table of [...order,'llm_model_config_versions'])if(cols[table].includes('id')){const [{seq}]=await tx`select pg_get_serial_sequence(${table},'id') as seq`;check(/^[a-z0-9_]+\.[a-z0-9_]+$/.test(seq),'Unexpected sequence identifier');const [prior]=await tx.unsafe('select last_value::text,is_called from '+seq);await tx`select setval(${seq}::regclass,greatest(${prior.last_value}::bigint,coalesce((select max(id) from ${tx(table)}),0),1),${prior.is_called} or exists(select 1 from ${tx(table)}))`;}
  return {...report,idempotent:false};
 });
}

async function main(){
 const args=process.argv.slice(2),value=(name:string,fallback?:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
 const sourceName=value('--source','stockdepth')!,targetName=value('--target','stockdepth_dev')!,directory=value('--backup-dir');
 check(directory,'Specify --backup-dir with verified source.dump and target.dump');check(args.includes('--rehearse')||args.includes('--apply'),'Choose --rehearse or --apply');check(!args.includes('--collision-check')||args.includes('--rehearse'),'Collision check requires rehearsal');check(sourceName!==targetName,'Source equals target');
 for(const file of ['source.dump','target.dump']){check(fs.statSync(path.join(directory,file)).size>0,'Backup missing');check(spawnSync('pg_restore',['--list',path.join(directory,file)],{encoding:'utf8'}).status===0,'Unreadable backup');}
 const source=connect(urlFor(sourceName)),admin=connect(urlFor('postgres'));let target:any,rehearsal:string|undefined;
 try{const data=await snapshot(source);check(Object.keys(data.rows).every(t=>order.includes(t)||excluded.includes(t)),'Unexpected source schema');
   if(args.includes('--rehearse')){rehearsal='stockdepth_import_rehearsal_'+randomUUID().replaceAll('-','');await admin.unsafe('create database "'+rehearsal+'"');const u=new URL(urlFor(rehearsal));const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:rehearsal};if(u.searchParams.has('sslmode'))env.PGSSLMODE=u.searchParams.get('sslmode')!;check(spawnSync('pg_restore',['--no-owner','--no-acl','--exit-on-error','--dbname',rehearsal,path.join(directory,'target.dump')],{env,encoding:'utf8'}).status===0,'Rehearsal restore failed');target=connect(urlFor(rehearsal));}
   else target=connect(urlFor(targetName));
   const legacyColumns=await target`select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='analysis_credits'`;
   check(legacyColumns.length===1,'Legacy import requires the 0043 compatibility schema. Restore the verified pre-normalization target backup into a disposable database, import there, then run the normal initializer to upgrade. Do not reimport into a normalized live database.');
   let collision:any;
   if(args.includes('--collision-check')){
     const legacyJob=data.rows.analysis_job_resumptions[0]?.job_id??data.rows.analysis_jobs[0].id;
     const fixtureUser=(await target`select id from users order by id limit 1`)[0].id;
     await target`insert into analysis_jobs(id,user_id,run_id,ticker,trade_date,analysts,status) values(${legacyJob},${fixtureUser},${'migration-fixture-'+randomUUID()},'IMPORT_FIXTURE','2026-10-16','[]','complete')`;
     data.rows.users[1].referred_by_user_id=data.rows.users.at(-1)!.id;
     data.digest=digest(data.rows);collision={job:legacyJob,user:data.rows.users[1].id,referrer:data.rows.users.at(-1)!.id};
   }
   const before=await snapshot(target);
   const priorMarkers=await target`select metadata from admin_audit_logs where action='database.legacy_import'`;
   const previouslyImported=priorMarkers.some((r:Row)=>JSON.parse(r.metadata).sourceDatabase===sourceName&&JSON.parse(r.metadata).sourceDigest===data.digest);
   if(!rehearsal&&!previouslyImported){const rehearsalReport=JSON.parse(fs.readFileSync(path.join(directory,'rehearsal-report.json'),'utf8'));check(rehearsalReport.importerDigest===importerDigest,'Importer changed since rehearsal');check(rehearsalReport.sourceDigest===data.digest,'Source drift since rehearsal');check(rehearsalReport.targetBeforeDigest===before.digest,'Target drift since rehearsal');}
   const report={...await importSnapshot(target,data,sourceName,targetName),targetBeforeDigest:before.digest};
   if(rehearsal){const after=await snapshot(target);const again=await importSnapshot(target,data,sourceName,targetName);check(again.idempotent,'Repeated import was not idempotent');check(after.digest===(await snapshot(target)).digest,'Repeated import changed data');}
   if(collision){const mappedJob=report.idMaps.analysis_jobs[collision.job];check(mappedJob!==collision.job,'Fixture did not cause an ID collision');const [ref]=await target`select referred_by_user_id from users where id=${report.idMaps.users[collision.user]}`;check(ref.referred_by_user_id===report.idMaps.users[collision.referrer],'Forward referrer remap failed');for(const old of data.rows.analysis_job_resumptions.filter(r=>r.job_id===collision.job)){const [row]=await target`select job_id from analysis_job_resumptions where id=${report.idMaps.analysis_job_resumptions[old.id]}`;check(row.job_id===mappedJob,'Composite-only resumption job remap failed');}}
   const filename=path.join(directory,collision?'collision-report.json':rehearsal?'rehearsal-report.json':report.idempotent?'idempotency-report.json':'import-report.json');fs.writeFileSync(filename,JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({mode:collision?'collision-rehearsal':rehearsal?'rehearsal':'apply',report:filename,added:report.added,mergedUsers:report.mergedUserCount,pausedJobs:report.pausedJobs,interruptedCalls:report.interruptedCalls,idempotent:report.idempotent}));
 }finally{await source.end();if(target)await target.end();if(rehearsal)await admin.unsafe('drop database if exists "'+rehearsal+'" with (force)');await admin.end();}
}
main().catch((e:any)=>{console.error('Legacy import failed: '+(e instanceof MigrationValidationError?e.message:e.code||e.name));process.exitCode=1;});
