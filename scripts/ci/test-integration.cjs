// PostgreSQL 16 only; every suite gets a disposable database on a CI-only server.
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {randomUUID, randomBytes} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {root, cleanCheckout, environment, run, report} = require('./runtime.cjs');
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const postgres = requireWeb('postgres');
const {drizzle} = requireWeb('drizzle-orm/postgres-js');
const {migrate} = requireWeb('drizzle-orm/postgres-js/migrator');
cleanCheckout();
const url = new URL(process.env.CI_POSTGRES_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.username, 'stockdepth_ci');
assert.equal(url.pathname, '/stockdepth_ci_admin');
assert(!url.search && url.port && url.port !== '5432', 'Use an explicit isolated CI port');
const admin = postgres(url.toString(), {max: 1, connect_timeout: 5, onnotice() {}});
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stockdepth-integration-'));
const runtime = path.join(temp, 'bin');
fs.mkdirSync(runtime);
const workers = path.join(root, 'apps/workers');
const tsx = path.join(workers, 'node_modules/.bin/tsx');
const python = require('node:child_process').execFileSync('python3.11', ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8'}).trim();
fs.symlinkSync(tsx, path.join(runtime, 'tsx'));
fs.symlinkSync(python, path.join(runtime, 'python'));
const env = {...environment(), STOCKDEPTH_RUNTIME_BIN: runtime,
  STOCKDEPTH_API_URL: 'http://127.0.0.1:1', STOCKDEPTH_API_KEY: 'ci-synthetic-api-key',
  STOCKDEPTH_MODEL_KEY_ID: 'ci', STOCKDEPTH_MODEL_KEYRING: JSON.stringify({ci: randomBytes(32).toString('base64url')}),
  PAPER_TRADER_AUTO_EXECUTE: 'false', PAPER_TRADER_MODEL_TIMEOUT_MS: '500', STAGE1_TEST_OUTPUT: path.join(temp, 'stability.json')};
const suites = [
  ['database-v2', 'scripts/tests/database-v2.ts', 'stockdepth_ci_v2_', false],
  ['database-integrity', 'scripts/tests/database-integrity.ts', 'stockdepth_ci_integrity_', false],
  ['worker-stability', 'apps/workers/tests/stage1-stability.ts', 'stockdepth_stage1_', true],
  ['worker-report-sync', 'apps/workers/tests/stage2-sync.ts', 'stockdepth_stage2_worker_', true],
  ['worker-crash-recovery', 'apps/workers/tests/ci-crash-recovery.ts', 'stockdepth_ci_crash_', true],
  ['worker-admission', 'apps/workers/tests/stage3-admission.ts', 'stockdepth_stage3_worker_', true],
  ['admin-concurrency', 'scripts/tests/admin-concurrency.ts', 'stockdepth_ci_admission_', true],
  ['model-availability', 'scripts/tests/model-availability.ts', 'stockdepth_ci_availability_', true],
  ['resume-with-models', 'scripts/tests/resume-with-models.ts', 'stockdepth_regression_', true],
];
const results = [];
async function main() {
  const [identity] = await admin`select current_database() name, current_setting('server_version_num')::int version`;
  assert.equal(identity.name, 'stockdepth_ci_admin');
  assert(identity.version >= 160000 && identity.version < 170000, 'PostgreSQL16 is required');
  try {
    for (const [name, file, prefix, schema] of suites) {
      const database = prefix + randomUUID().replaceAll('-', '');
      const started = Date.now();
      await admin.unsafe(`create database "${database}"`);
      const suiteURL = new URL(url); suiteURL.pathname = '/' + database;
      const client = postgres(suiteURL.toString(), {max: 1, onnotice() {}});
      try {
        if (schema) await migrate(drizzle(client), {migrationsFolder: path.join(root, 'apps/web/lib/db/migrations')});
        await client.end();
        await run(tsx, [path.join(root, file)], {cwd: file.startsWith('apps/workers/') ? workers : root,
          env: {...env, POSTGRES_URL: suiteURL.toString(), TSX_TSCONFIG_PATH: path.join(workers, 'tsconfig.json')}});
        results.push({name, status: 'passed', durationMs: Date.now() - started});
      } finally {
        await client.end();
        await admin.unsafe(`drop database if exists "${database}" with (force)`);
      }
    }
    await run(tsx, [path.join(root, 'scripts/tests/round5-security-db.ts')], {cwd: workers,
      env: {...env, SECURITY_TEST_ADMIN_URL: url.toString(), TSX_TSCONFIG_PATH: path.join(workers, 'tsconfig.json')}});
    results.push({name: 'key-migration-and-retention', status: 'passed'});
    assert.equal(results.length, suites.length + 1);
    console.log(JSON.stringify({suite: 'integration', count: results.length, status: 'passed'}));
  } finally {
    report('integration', {suites: results, expected: suites.length + 1});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await admin.end();
  fs.rmSync(temp, {recursive: true, force: true});
  console.log(JSON.stringify({cleanup: 'integration temporary files and suite databases', removed: !fs.existsSync(temp)}));
});
