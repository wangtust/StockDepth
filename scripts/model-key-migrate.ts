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
