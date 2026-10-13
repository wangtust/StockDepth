import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ResourceMonitor } from '../src/resources';

async function originalSnapshot() {
  const memory = await readFile('/proc/meminfo', 'utf8');
  let rss = 0, scanned = 0;
  for (const pid of (await readdir('/proc')).filter(value => /^\d+$/.test(value))) {
    try {
      const command = await readFile(`/proc/${pid}/cmdline`, 'utf8'); scanned++;
      if (!command.split('\0').some(arg => arg.endsWith('/analysis_runner.py'))) continue;
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      rss += Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0);
    } catch {}
  }
  return { scanned, available: Number(memory.match(/MemAvailable:\s+(\d+)/)?.[1] || 0), rss };
}
async function main() {
  const results = [];
  for (let round=1;round<=3;round++) {
    const before: number[] = [], after: number[] = [];
    const monitor = new ResourceMonitor();
    let scanned = 0;
    for (let i=0;i<10;i++) { const start=performance.now(); scanned=(await originalSnapshot()).scanned; before.push(performance.now()-start); }
    for (let i=0;i<10;i++) { const start=performance.now(); await monitor.snapshot(); after.push(performance.now()-start); }
    const result={ round, beforeMs: before, afterMs: after, beforeScans:10, afterScans:monitor.scans, processes:scanned,
      beforeTotalMs:before.reduce((a,b)=>a+b,0), afterTotalMs:after.reduce((a,b)=>a+b,0) };
    results.push(result);console.log(JSON.stringify(result));
  }
  const directory=resolve('../../var/performance/stage1-implementation');
  await mkdir(directory,{recursive:true});
  await writeFile(directory+'/resources-comparison.json',JSON.stringify({
    scope:'10 sequential snapshots per round; after includes one cold discovery; fresh MemAvailable on every call; default 30-second discovery cache', results,
  },null,2));
}
main().catch(error=>{console.error(error.name);process.exitCode=1;});
