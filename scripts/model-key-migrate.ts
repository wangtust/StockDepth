// Explicit operator invocation only; environment is supplied by coordinator, never loads dotenv.
import postgres from '../apps/web/node_modules/postgres';
import { decryptModelKey, encryptModelKey } from '../apps/web/lib/security/model-key';
const apply = process.argv.includes('--apply');
const rotate = process.argv.includes('--rotate');
const url = process.env.POSTGRES_URL;
if (!url) throw new Error('Database environment required');
if (apply && process.env.STOCKDEPTH_MODEL_READERS_READY !== 'true') throw new Error('Reader readiness required');
const db = postgres(url, { max: 1, onnotice() {} });
async function main() {
 await db.begin(apply ? '' : 'read only', async tx => {
  const [shape]=await tx`select exists(select 1 from information_schema.columns where table_schema=current_schema() and table_name='llm_model_configs' and column_name='api_key') as legacy`;
  if(!shape.legacy) {
   const rows=apply?await tx`select c.id, v.* from llm_model_configs c join llm_model_config_versions v on v.id=c.current_version_id and v.config_id=c.id order by c.id for update of c`:await tx`select c.id as identity_id,v.* from llm_model_configs c join llm_model_config_versions v on v.id=c.current_version_id and v.config_id=c.id order by c.id`;
   let encrypted=0,unset=0,changed=0;
   for(const row of rows) {
    if(!row.encrypted_api_key){unset++;continue;}
    const plaintext=decryptModelKey(row.encrypted_api_key);encrypted++;
    if(rotate&&row.encrypted_api_key.split(':')[2]!==process.env.STOCKDEPTH_MODEL_KEY_ID) {
     const envelope=encryptModelKey(plaintext);changed++;
     if(apply){
      // Rotation appends a version; historical ciphertext must remain decryptable by retaining old keyring entries.
      const [version]=await tx`insert into llm_model_config_versions(config_id,version,provider,base_url,model_name,model_options,encrypted_api_key,input_price,cache_price,output_price,price_currency,price_unit_tokens,provenance)
       select config_id,(select coalesce(max(v.version),0)+1 from llm_model_config_versions v where v.config_id=${row.config_id}),provider,base_url,model_name,model_options,${envelope},input_price,cache_price,output_price,price_currency,price_unit_tokens,'configured'
       from llm_model_config_versions where id=${row.id} returning id`;
      await tx`update llm_model_configs set current_version_id=${version.id},updated_at=now() where id=${row.config_id}`;
     }
    }
   }
   console.log(JSON.stringify({dryRun:!apply,total:rows.length,legacy:0,encrypted,unset,candidates:changed}));return;
  }
  const rows = apply ? await tx`select id, api_key from llm_model_configs order by id for update` : await tx`select id, api_key from llm_model_configs order by id`;
  let legacy = 0, encrypted = 0, changed = 0, unset = 0;
  for (const row of rows) {
   // Local/no-key configurations contain no secret. Preserve their unset state.
   if (row.api_key === '') { unset++; continue; }
   const isEncrypted = row.api_key.startsWith('sdkey:');
   const plaintext = decryptModelKey(row.api_key);
   if (isEncrypted) encrypted++; else legacy++;
   if (!isEncrypted || (rotate && row.api_key.split(':')[2] !== process.env.STOCKDEPTH_MODEL_KEY_ID)) {
    // Preflight encryption even in dry-run. No plaintext output/backups.
    const envelope = encryptModelKey(plaintext);
    if (apply) await tx`update llm_model_configs set api_key=${envelope} where id=${row.id}`;
    changed++;
   }
  }
  console.log(JSON.stringify({ dryRun: !apply, total: rows.length, legacy, encrypted, unset, candidates: changed }));
 });
}
main().catch(() => { console.error('model_key_migration_failed'); process.exitCode = 1; }).finally(() => db.end());
