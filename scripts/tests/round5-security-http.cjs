// Full-schema private built server only; no Worker/model requests or dotenv.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),name=process.env.ROUND5_TEST_DATABASE;
assert.match(name||'',/^stockdepth_round4_backend_r5coord_http[0-9]+$/);
const url='postgres://ubuntu@127.0.0.1:55483/'+name,db=require(root+'/apps/web/node_modules/postgres')(url,{max:1,onnotice(){}});
const ts=require(root+'/apps/workers/node_modules/typescript');
const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(root+'/apps/web/lib/security/model-key.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);
const env={...process.env,POSTGRES_URL:url,STOCKDEPTH_MODEL_READERS_READY:'true',STOCKDEPTH_MODEL_KEY_ID:'private',STOCKDEPTH_MODEL_KEYRING:JSON.stringify({private:crypto.randomBytes(32).toString('base64url')})};
function migrate(args){const p=spawnSync(process.execPath,['--import','tsx',root+'/scripts/model-key-migrate.ts',...args],{cwd:root+'/apps/workers',env,encoding:'utf8'});assert.equal(p.status,0);return JSON.parse(p.stdout.trim());}
(async()=>{
const [identity]=await db`select current_database() name,inet_server_port() port,inet_server_addr()::text host`;assert.equal(identity.name,name);assert.equal(identity.port,55483);assert.equal(identity.host,'127.0.0.1/32');
assert.equal((await db`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n,30);
const [row]=await db`insert into llm_model_configs(name,provider,base_url,api_key,model_name,is_default,is_active) values('private-encrypted-http','mock','http://127.0.0.1:1','synthetic-http-key','mock',false,false) returning id`;
const preflight=migrate([]);assert(preflight.candidates>0);assert(preflight.unset>0);assert(migrate(['--apply']).candidates>0);assert.equal(migrate(['--apply']).candidates,0);
assert.equal((await db`select count(*)::int n from llm_model_configs where api_key=''`)[0].n,preflight.unset);
const [stored]=await db`select api_key from llm_model_configs where id=${row.id}`;assert.equal(m.exports.decryptModelKey(stored.api_key,env),'synthetic-http-key');assert.throws(()=>m.exports.decryptModelKey(stored.api_key,{}),/unavailable/);
const [admin]=await db`insert into users(email,password_hash,role) values(${crypto.randomUUID()+'@isolated.invalid'},'test-only','admin') returning id`;
const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');const token=await new SignJWT({user:{id:admin.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setExpirationTime('10m').sign(new TextEncoder().encode('round4-private-http-secret'));
const response=await fetch('http://127.0.0.1:3304/admin/models',{headers:{cookie:'session='+token}});assert.equal(response.status,200);const body=await response.text();assert(body.includes('configured'));assert(!body.includes('synthetic-http-key'));assert(!body.includes(stored.api_key));
console.log('PASS full-schema migration dryrun/apply/repeat, missing-key failure, built admin opaque display; no model invocation');
})().catch(e=>{console.error('private_security_http_failed',e.name);console.error(String(e.stack).split('\n').filter(l=>l.trim().startsWith('at ')).join('\n'));process.exitCode=1}).finally(()=>db.end());
