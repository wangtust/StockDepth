// Existing CDP component tests, synthetic loopback fixtures, no application server.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..');
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const suites = [
  'frontend-admin-forms-stage4.cjs',
  'frontend-admin-race-stage4.cjs',
  'frontend-coordinator-interactions-stage4.cjs',
  'frontend-experience-interactions-stage4.cjs',
];
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {cwd: root, stdio: 'inherit', timeout: 180000, ...options});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(' ')} failed (signal=${result.signal})`);
}
if (process.argv.includes('--install-browser')) {
  run('pnpm', ['--dir', 'apps/web', 'exec', 'playwright', 'install',
    ...(process.argv.includes('--with-deps') ? ['--with-deps'] : []), 'chromium']);
} else {
  assert.equal(process.versions.node.split('.')[0], '22', 'Node22 is required');
  assert(!fs.existsSync(path.join(root, '.env')), 'Run in a clean clone without root .env');
  const executable = require('../tests/frontend-runtime.cjs').chromium();
  assert(suites.length > 0);
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'stockdepth-frontend-'));
  try {
    for (const suite of suites) {
      const directory = path.join(output, suite.replace('.cjs', ''));
      run(process.execPath, [path.join(root, 'scripts/tests', suite), 'after'], {
        env: {...process.env, FRONTEND_CHROMIUM: executable, FRONTEND_TEST_OUTPUT: directory},
      });
    }
    console.log(JSON.stringify({suite: 'frontend', count: suites.length, status: 'passed'}));
  } finally {
    fs.rmSync(output, {recursive: true, force: true});
    console.log(JSON.stringify({cleanup: 'frontend synthetic output', removed: !fs.existsSync(output)}));
  }
}
