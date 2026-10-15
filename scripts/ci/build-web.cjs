// Build in a clean checkout with synthetic configuration only.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if (process.versions.node.split('.')[0] !== '22') throw new Error('Node22 is required');
for (const directory of [root, path.join(root, 'apps/web')]) {
  for (const name of fs.readdirSync(directory)) {
    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
      throw new Error('Build requires a clean checkout without dotenv files');
    }
  }
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|HOME|TMPDIR|TEMP|TMP|LANG|LC_ALL|SYSTEMROOT|CI|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/.test(key)));
Object.assign(env, {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  POSTGRES_URL: 'postgres://ci:ci@127.0.0.1:1/stockdepth_ci_build',
  AUTH_SECRET: 'stockdepth-ci-synthetic-auth-secret-for-build-only',
  STRIPE_SECRET_KEY: 'sk_test_placeholder_ci_build',
  STRIPE_WEBHOOK_SECRET: 'whsec_placeholder_ci_build',
  BASE_URL: 'http://127.0.0.1:3000',
});
const result = spawnSync('pnpm', ['--dir', 'apps/web', 'build'], {
  cwd: root, env, stdio: 'inherit', timeout: 15 * 60 * 1000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
