const path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
require(root+'/apps/web/node_modules/dotenv').config({path:root+'/.env'});
const sql=require(root+'/apps/web/node_modules/postgres')(process.env.POSTGRES_URL,{max:1});
(async()=>{try{
const [user]=await sql`select id from users where status='active' and deleted_at is null order by (role='member') desc,id limit 1`;
const {SignJWT}=await import(root+'/apps/web/node_modules/jose/dist/webapi/index.js');
const token=await new SignJWT({user:{id:user.id},expires:new Date(Date.now()+600000).toISOString()}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
await new Promise((resolve,reject)=>{
const child=spawn(process.env.STOCKDEPTH_K6_BINARY||'/home/ubuntu/.local/bin/k6',['run','--quiet','--summary-export',root+'/var/k6-read-summary.json',root+'/scripts/diagnostics/read-load.k6.js'],{env:{...process.env,SESSION:token,K6_NO_USAGE_REPORT:'true'},stdio:['ignore','inherit','inherit']});
child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('k6 failed with exit '+code)));
});
}finally{await sql.end()}})().catch(e=>{console.error(e.message);process.exitCode=1});
