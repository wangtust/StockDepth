// Preflight for 0044: preserve credentials as envelopes before SQL removes
// the legacy execution columns. No credential or connection data is logged.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/apps/workers/node_modules/typescript');
const compiled = ts.transpileModule(fs.readFileSync(root + '/apps/web/lib/security/model-key.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports);
const { encryptModelKey, decryptModelKey } = loaded.exports;

exports.prepareModelNormalization = async function(sql) {
  const [legacy] = await sql`select 1 from information_schema.columns
    where table_schema='public' and table_name='llm_model_configs' and column_name='api_key'`;
  if (!legacy) return;
  await sql.begin(async tx => {
    const configs = await tx`select id, api_key from llm_model_configs for update`;
    for (const row of configs) {
      if (!row.api_key) continue;
      const plaintext = decryptModelKey(row.api_key);
      if (!plaintext) throw new Error('Model credential preflight failed');
      if (!row.api_key.startsWith('sdkey:')) {
        await tx`update llm_model_configs set api_key=${encryptModelKey(plaintext)} where id=${row.id}`;
      }
    }
  });
};
