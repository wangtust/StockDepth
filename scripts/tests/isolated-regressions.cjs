// Owns every test database; the configured database is used only to CREATE/DROP.
const path = require('node:path');
const { mkdtemp, symlink, writeFile, chmod, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const modules = root + '/apps/web/node_modules';
require(modules + '/dotenv').config({ path: root + '/.env' });
const postgres = require(modules + '/postgres');
const { drizzle } = require(modules + '/drizzle-orm/postgres-js');
const { migrate } = require(modules + '/drizzle-orm/postgres-js/migrator');
const suites = {
  stability: ['stockdepth_stage1_', 'apps/workers/tests/stage1-stability.ts', 'apps/workers/tsconfig.json'],
  resume: ['stockdepth_regression_', 'scripts/tests/resume-with-models.ts', 'apps/web/tsconfig.json'],
  sync: ['stockdepth_stage2_worker_', 'apps/workers/tests/stage2-sync.ts', 'apps/workers/tsconfig.json'],
  admission: ['stockdepth_stage3_worker_', 'apps/workers/tests/stage3-admission.ts', 'apps/workers/tsconfig.json'],
  availability: ['stockdepth_regression_', 'scripts/tests/model-availability.ts', 'apps/web/tsconfig.json'],
};
async function main() {
  const source = process.env.POSTGRES_URL;
  if (!source) throw new Error('POSTGRES_URL required');
  const selected = process.argv.slice(2);
  const names = selected.length ? selected : Object.keys(suites);
  for (const name of names) if (!suites[name]) throw new Error('Unknown regression suite');
  const admin = postgres(source, { max: 1, onnotice() {} });
  const runtime = await mkdtemp(path.join(tmpdir(), 'stockdepth-regression-runtime-'));
  try {
    const python = process.env.STOCKDEPTH_TEST_PYTHON || (process.env.STOCKDEPTH_RUNTIME_BIN && path.join(process.env.STOCKDEPTH_RUNTIME_BIN, 'python'));
    if (!python) throw new Error('Configure STOCKDEPTH_RUNTIME_BIN or STOCKDEPTH_TEST_PYTHON.');
    await symlink(python, runtime + '/python');
    await writeFile(runtime + '/tsx', `#!/bin/sh\nexec '${process.execPath}' '${modules}/tsx/dist/cli.mjs' --tsconfig '${root}/apps/workers/tsconfig.json' "$@"\n`);
    await chmod(runtime + '/tsx', 0o700);
    for (const name of names) {
      const [prefix, file, tsconfig] = suites[name];
      const database = prefix + randomUUID().replaceAll('-', '');
      const url = new URL(source); url.pathname = '/' + database; url.search = '';
      let connection, created = false;
      try {
        await admin.unsafe(`create database "${database}"`); created = true;
        connection = postgres(url.toString(), { max: 1, onnotice() {} });
        await migrate(drizzle(connection), { migrationsFolder: root + '/apps/web/lib/db/migrations' });
        await connection.end(); connection = null;
        const result = spawnSync(process.execPath, [modules + '/tsx/dist/cli.mjs', '--tsconfig', root + '/' + tsconfig, root + '/' + file], {
          cwd: name === 'stability' ? root + '/apps/workers' : root, encoding: 'utf8', timeout: 180000,
          env: { ...process.env, STOCKDEPTH_RUNTIME_BIN: runtime, STAGE1_TEST_OUTPUT: runtime + '/stage1.json', PAPER_TRADER_MODEL_TIMEOUT_MS: '1000', POSTGRES_URL: url.toString(), STOCKDEPTH_MODEL_KEY_ID: 'fixture',
            STOCKDEPTH_MODEL_KEYRING: JSON.stringify({ fixture: randomBytes(32).toString('base64url') }) },
        });
        // Child diagnostics may contain connection strings. Redact before output.
        const output = ((result.stdout || '') + (result.stderr || '')).replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted database URL]');
        process.stdout.write(output);
        if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status}, ${result.error?.code || 'test failure'})`);
        console.log(`PASS isolated regression: ${name}`);
      } finally {
        if (connection) await connection.end();
        if (created) await admin.unsafe(`drop database "${database}" with (force)`);
      }
    }
  } finally { await admin.end(); await rm(runtime, { recursive: true, force: true }); }
}
main().catch(() => { console.error('FAIL isolated regressions; see sanitized suite diagnostics above'); process.exitCode = 1; });
