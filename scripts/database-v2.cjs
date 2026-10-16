// Explicit, isolated V2 database selection. Never edits .env or drops databases.
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env', quiet: true });

async function main() {
  const [action, ...command] = process.argv.slice(2);
  if (!['prepare', 'run'].includes(action) || (action === 'run' && !command.length)) {
    throw new Error('Usage: node scripts/database-v2.cjs prepare | run <command> [args]');
  }
  if (!process.env.POSTGRES_URL) throw new Error('POSTGRES_URL is required.');
  const target = process.env.STOCKDEPTH_V2_DATABASE_NAME || 'stockdepth_v2';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(target) || ['postgres','template0','template1'].includes(target)) {
    throw new Error('Invalid V2 database name.');
  }
  const original = new URL(process.env.POSTGRES_URL);
  // Once .env has been switched to V2 this also works as a repeatable check/run
  // entrypoint. It never drops a database or rewrites the configured connection.
  const candidate = new URL(original);
  candidate.pathname = '/' + target;
  const env = { ...process.env, POSTGRES_URL: candidate.toString(), STOCKDEPTH_NEXT_DIST_DIR: '.next-v2' };
  if (action === 'prepare') {
    const postgres = require(root + '/apps/web/node_modules/postgres');
    const admin = postgres(original.toString(), { max: 1, onnotice: () => {} });
    try {
      // Serialize repeated prepare invocations on this same source database.
      await admin`select pg_advisory_lock(739421, 40)`;
      const exists = await admin`select 1 from pg_database where datname = ${target}`;
      if (!exists.length) await admin.unsafe('CREATE DATABASE "' + target + '"');
      console.log('V2 database: ' + target + (exists.length ? ' (existing)' : ' (created)'));
    } finally {
      await admin`select pg_advisory_unlock(739421, 40)`.catch(() => {});
      await admin.end();
    }
    // Preparation creates no user or provider configuration and copies no source data.
    env.STOCKDEPTH_ADMIN_EMAIL = '';
    env.STOCKDEPTH_ADMIN_PASSWORD = '';
    command.push(process.execPath, path.join(root, 'scripts/initialize-database.cjs'));
  } else if (command.some(value => /(?:^|\/)stockdepth$|(?:^|\/)manage\.py$/.test(value))) {
    throw new Error('Use direct commands: the process manager reloads .env and would override V2 selection.');
  }
  const child = spawn(command[0], command.slice(1), { cwd: root, env, stdio: 'inherit' });
  child.on('error', () => { console.error('Unable to start V2 command.'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
main().catch(() => {
  // Do not print connection details or errors that could contain credentials.
  console.error('V2 database command failed. Check command syntax, database permissions and configuration.');
  process.exitCode = 1;
});
