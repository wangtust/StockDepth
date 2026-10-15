// Existing CDP component tests, synthetic loopback fixtures, no application server.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const group = process.argv.find(arg => arg.startsWith('--group='))?.split('=')[1] || 'all';
assert(['all', 'admin', 'experience', 'coordinator'].includes(group), 'Unknown frontend group');
// Latest suite for each surface; older phase snapshots retain their historical CLI.
const active = [
  'frontend-admin-forms-stage4.cjs', 'frontend-admin-interactions-stage4.cjs',
  'frontend-admin-model-save-stage2.cjs', 'frontend-admin-navigation-stage3.cjs',
  'frontend-admin-race-stage4.cjs', 'frontend-admin-report-stage3.cjs', 'frontend-admin-stage3.cjs',
  'frontend-coordinator-admin-extra-stage3.cjs', 'frontend-coordinator-interactions-stage4.cjs',
  'frontend-coordinator-stage3.cjs', 'frontend-experience-interactions-stage4.cjs',
  'frontend-experience-pages-stage4.cjs', 'frontend-experience-stage4.cjs',
];
const suites = active.filter(name => group === 'all' || name.startsWith(`frontend-${group}-`));

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {cwd: root, stdio: 'inherit', timeout: 180000, ...options});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(' ')} failed (signal=${result.signal})`);
}
if (process.argv.includes('--install-browser')) {
  run('pnpm', ['--dir', 'apps/web', 'exec', 'playwright', 'install',
    ...(process.argv.includes('--with-deps') ? ['--with-deps'] : []), 'chromium']);
} else {
  require('./runtime.cjs').cleanCheckout();
  assert(!fs.existsSync(path.join(root, '.env')), 'Run in a clean clone without root .env');
  const executable = require('../tests/frontend-runtime.cjs').chromium();
  assert(suites.length > 0);
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'stockdepth-frontend-'));
  const completed = [];
  try {
    for (const suite of suites) {
      const directory = path.join(output, suite.replace('.cjs', ''));
      run(process.execPath, [path.join(root, 'scripts/tests', suite), 'after'], {
        env: {...require('./runtime.cjs').environment(), FRONTEND_CHROMIUM: executable, FRONTEND_TEST_OUTPUT: directory},
      });
      completed.push(suite);
    }
    const summary = {suite: 'frontend', group, count: suites.length, status: 'passed'};
    require('./runtime.cjs').report('frontend-' + group, summary);
    console.log(JSON.stringify(summary));
  } finally {
    require('./runtime.cjs').report('frontend-' + group, {group, expected: suites.length, completed, status: completed.length === suites.length ? 'passed' : 'failed'});
    fs.rmSync(output, {recursive: true, force: true});
    console.log(JSON.stringify({cleanup: 'frontend synthetic output', removed: !fs.existsSync(output)}));
  }
}
