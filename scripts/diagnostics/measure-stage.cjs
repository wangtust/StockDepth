const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const stage = process.argv[2];
if (!stage || !/^[a-z0-9-]+$/.test(stage)) throw Error('Supply a stage name');
const directory = path.join(root, 'var/performance', stage);
fs.mkdirSync(directory, { recursive: true });
function memory() {
  const processes = [];
  for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      const kind = cmd.startsWith('next-server') ? 'web' : cmd.includes('src/analysis-worker.ts') ? 'worker' : cmd.includes('stockdepth.api.server') ? 'api' : cmd.includes('analysis_runner.py') ? 'runner' : null;
      if (!kind) continue;
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      processes.push({ pid: Number(pid), kind, rssKb: Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0) });
    } catch {}
  }
  return { time: new Date().toISOString(), processes };
}
(async () => {
const samples = [];
const sample = () => samples.push(memory());
sample();
const ticker = setInterval(sample, 1000);
try {
fs.writeFileSync(path.join(directory, 'memory-before.json'), JSON.stringify(samples[0], null, 2));
for (const script of ['latency', 'browser-latency', 'run-load']) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script + '.cjs')], { cwd: root, env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', status => { clearTimeout(timeout); resolve({ stdout, stderr, status }); });
  });
  fs.writeFileSync(path.join(directory, script + '.log'), result.stdout + result.stderr);
  console.log(stage, script, result.status === 0 ? 'passed' : 'failed');
  if (result.status !== 0) process.exitCode = 1;
  if (script === 'run-load' && fs.existsSync(root + '/var/k6-read-summary.json'))
    fs.copyFileSync(root + '/var/k6-read-summary.json', directory + '/k6-summary.json');
}
fs.writeFileSync(path.join(directory, 'memory-after.json'), JSON.stringify(memory(), null, 2));

} finally {
  clearInterval(ticker); sample();
  fs.writeFileSync(path.join(directory, 'memory-samples.json'), JSON.stringify(samples, null, 2));
}
})().catch(error => { console.error(error.name); process.exitCode = 1; });
