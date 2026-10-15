const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
function cleanCheckout() {
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Node22 is required');
  for (const directory of [root, path.join(root, 'apps/web'), path.join(root, 'apps/workers')]) {
    if (fs.readdirSync(directory).some(name => name === '.env' || (name.startsWith('.env.') && name !== '.env.example'))) {
      throw new Error('CI requires a clean checkout without dotenv files');
    }
  }
}
function environment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|HOME|TMPDIR|TEMP|TMP|LANG|LC_ALL|SYSTEMROOT|CI|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/.test(key)));
}
async function run(executable, args, {cwd = root, env = environment(), timeout = 180000} = {}) {
  const child = spawn(executable, args, {cwd, env, stdio: 'inherit', detached: true});
  let expired = false;
  const timer = setTimeout(() => { expired = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeout);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? signal)); });
    if (expired || code !== 0) throw new Error(`${path.basename(args[0] || executable)} failed: ${expired ? 'timeout' : code}`);
  } finally { clearTimeout(timer); }
}
function report(name, value) {
  if (!process.env.CI_REPORT_DIR) return;
  fs.mkdirSync(process.env.CI_REPORT_DIR, {recursive: true});
  fs.writeFileSync(path.join(process.env.CI_REPORT_DIR, name + '.json'), JSON.stringify(value, null, 2));
}
module.exports = {root, cleanCheckout, environment, run, report};
