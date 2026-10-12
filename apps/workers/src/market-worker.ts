import '../env';
import { client } from '@/lib/db/drizzle';
import { queueMarketScope, runMarketBatch } from '@/lib/market/sync';
import { validateProvider, type MarketProvider } from '@/lib/market/provider';
import { readFile } from 'node:fs/promises';
const once=process.argv.includes('--once');
const bounded=(name:string,fallback:number,max:number)=>{const n=Number(process.env[name]);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback;};
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function main() {
  let provider:MarketProvider|undefined;
  if (process.env.MARKET_MOCK_FILE) {
    // Mock writes cannot accept production URLs; assert the server identity too.
    const url=new URL(process.env.POSTGRES_URL!);
    if (url.hostname!=='127.0.0.1'||url.port!=='55483'||!/^\/stockdepth_round4_backend_[a-z0-9_]+$/.test(url.pathname)) throw new Error('mock_requires_private_database');
    const identity=await client`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;
    if (identity[0].name!==url.pathname.slice(1)||identity[0].host!=='127.0.0.1/32'||identity[0].port!==55483) throw new Error('mock_database_identity_mismatch');
    const fixture=JSON.parse(await readFile(process.env.MARKET_MOCK_FILE,'utf8'));
    provider=async symbol=>validateProvider(fixture[symbol],symbol);
  }
  if (process.argv.includes('--initialize-catalog')) {
    console.log(JSON.stringify({worker:'market',initialized:await queueMarketScope(bounded('MARKET_CATALOG_INIT_LIMIT',100,500))}));
    return;
  }
  do {
    const result=await runMarketBatch({limit:bounded('MARKET_SYNC_BATCH_SIZE',10,100),concurrency:bounded('MARKET_PROVIDER_CONCURRENCY',2,4),provider});
    if (result.claimed || once) console.log(JSON.stringify({worker:'market',...result}));
    if (once) break;
    const until=Date.now()+bounded('MARKET_WORKER_POLL_MS',60_000,300_000);
    while(!stopping && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,500));
  } while(!stopping);
}
main().catch(()=>{console.error('market_worker_failed');process.exitCode=1;}).finally(()=>client.end());
