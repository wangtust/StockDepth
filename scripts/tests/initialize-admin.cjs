const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compare } = require(path.resolve(__dirname, '../../apps/web/node_modules/bcryptjs'));
const { initializeAdmin } = require('../initialize-admin.cjs');

const config = { STOCKDEPTH_ADMIN_EMAIL: 'admin@example.com', STOCKDEPTH_ADMIN_PASSWORD: 'example-password' };

test('creates an administrator with a verified password hash', async () => {
  const calls = [];
  const sql = async (strings, ...values) => { const query = strings.join('?'); calls.push({query, values}); return query.includes('insert into users') ? [{id: 123, analysis_credits: 0}] : []; };
  sql.begin = async callback => callback(sql);
  await initializeAdmin(sql, config);
  assert.match(calls[2].query, /insert into users.*super_admin/);
  assert.equal(calls[2].values[0], config.STOCKDEPTH_ADMIN_EMAIL);
  assert.equal(await compare(config.STOCKDEPTH_ADMIN_PASSWORD, calls[2].values[1]), true);
  assert.match(calls[2].query, /super_admin', 0/,'new account starts at zero before real grant');
  assert.match(calls[3].query, /billing_accounts.*for update/);
  assert.deepEqual(calls[3].values, [123]);
  assert.match(calls[4].query, /insert into credit_transactions.*ledger_sequence,balance_after,operation_key/);
  assert.match(calls[4].query, /10,'initial_admin_grant',1,10/);
  assert.deepEqual(calls[4].values, [123, 'initial-grant:123']);
  assert.match(calls[5].query, /update billing_accounts set analysis_credits=10,ledger_sequence=1/);
  assert.deepEqual(calls[5].values, [123]);
  assert.match(calls[6].query, /update users set analysis_credits=10/);
  assert.deepEqual(calls[6].values, [123]);
  assert.equal(calls.length,7);
});

test('existing administrator skips configuration validation and all writes', async () => {
  let calls = 0;
  await initializeAdmin(async () => { calls++; return [{ id: 1 }]; }, {});
  assert.equal(calls, 1);
});

test('missing configuration skips creation, partial or invalid configuration fails', async () => {
  let calls = 0;
  const sql = async () => { calls++; return []; };
  await initializeAdmin(sql, {});
  assert.equal(calls, 1);
  for (const invalid of [
    { STOCKDEPTH_ADMIN_EMAIL: config.STOCKDEPTH_ADMIN_EMAIL },
    { ...config, STOCKDEPTH_ADMIN_EMAIL: 'invalid' },
    { ...config, STOCKDEPTH_ADMIN_PASSWORD: 'short' },
    { ...config, STOCKDEPTH_ADMIN_PASSWORD: '密'.repeat(25) },
  ]) await assert.rejects(initializeAdmin(sql, invalid));
});

test('an existing email is never promoted or overwritten', async () => {
  let calls = 0;
  const sql = async () => ++calls === 1 ? [] : [{ id: 2 }];
  await assert.rejects(initializeAdmin(sql, config), /邮箱已被/);
  assert.equal(calls, 2);
});
