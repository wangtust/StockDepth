const path = require('node:path');
const {root, cleanCheckout, environment, run, report} = require('./runtime.cjs');
cleanCheckout();
const suites = [
  ['scripts/tests/round5-security.ts', true],
  ['scripts/tests/round5-security-readers.cjs', false],
  ['scripts/tests/round5-security-admin-patch.cjs', false],
  ['scripts/tests/initialize-admin.cjs', false],
  ['scripts/tests/ci-auth.cjs', false],
  ['scripts/tests/worker-request.ts', true],
];
const results = [];
(async () => {
  try {
    for (const [file, typescript] of suites) {
      await run(typescript ? path.join(root, 'apps/workers/node_modules/.bin/tsx') : process.execPath, [path.join(root, file)], {
        env: {...environment(), TSX_TSCONFIG_PATH: path.join(root, 'apps/workers/tsconfig.json')},
      });
      results.push({file, status: 'passed'});
    }
    console.log(JSON.stringify({suite: 'security', count: results.length, status: 'passed'}));
  } finally { report('security', {suites: results, expected: suites.length}); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
