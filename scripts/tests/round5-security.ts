import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { encryptModelKey, decryptModelKey, maskedModelKey, modelConfigWrite, readModelConfig } from '../../apps/web/lib/security/model-key';
const a = randomBytes(32).toString('base64url'), b = randomBytes(32).toString('base64url');
const env = { STOCKDEPTH_MODEL_KEY_ID: 'a', STOCKDEPTH_MODEL_KEYRING: JSON.stringify({ a, b }) };
const secret = 'synthetic-isolated-key';
let checks = 0;
function check(fn: () => void) { fn(); checks++; }
try {
check(() => assert.equal(decryptModelKey(secret, {}), secret));
const stored = encryptModelKey(secret, env);
check(() => assert.equal(decryptModelKey(stored, env), secret));
check(() => assert.notEqual(encryptModelKey(secret, env), stored));
check(() => assert(!stored.includes(secret)));
for (const index of [1, 2, 3, 4, 5]) check(() => {
  const parts = stored.split(':'); parts[index] = index === 1 ? 'v2' : index === 2 ? 'b' : (parts[index][0] === 'A' ? 'B' : 'A') + parts[index].slice(1);
  assert.throws(() => decryptModelKey(parts.join(':'), env), /^Error: Model key unavailable or invalid$/);
});
for (const invalid of ['sdkey:legacy', stored + ':extra', stored.replace(':v1:', ':v0:')]) check(() => assert.throws(() => decryptModelKey(invalid, env)));
check(() => assert.throws(() => decryptModelKey(stored, {})));
check(() => assert.throws(() => encryptModelKey(secret, {})));
check(() => assert.throws(() => encryptModelKey(secret, { ...env, STOCKDEPTH_MODEL_KEYRING: '{invalid' })));
const rotated = { ...env, STOCKDEPTH_MODEL_KEY_ID: 'b' };
check(() => assert.equal(decryptModelKey(stored, rotated), secret));
const next = encryptModelKey(decryptModelKey(stored, rotated), rotated);
check(() => assert.equal(decryptModelKey(next, { ...rotated, STOCKDEPTH_MODEL_KEYRING: JSON.stringify({ b }) }), secret));
check(() => assert.throws(() => decryptModelKey(stored, { ...rotated, STOCKDEPTH_MODEL_KEYRING: JSON.stringify({ b }) })));
check(() => assert.equal(maskedModelKey(secret), 'configured'));
check(() => assert.equal(maskedModelKey(stored), 'configured'));
// Actual shared setter/getter with synthetic environment; no network or real config.
Object.assign(process.env, env);
check(() => assert.equal(readModelConfig(modelConfigWrite({ id: 1, apiKey: secret })).apiKey, secret));
for (const file of ['apps/workers/src/analysis-worker.ts', 'apps/workers/src/paper-trader-worker.ts', 'apps/web/lib/analysis/model-configs-server.ts']) check(() => {
 const source = readFileSync(path.resolve(__dirname, '../..', file), 'utf8'); assert(source.includes("@/lib/security/model-key"));
});
console.log(`PASS security checks=${checks}; synthetic keys; no network`);

} catch { console.error('security_checks_failed'); process.exitCode = 1; }
