import { readFile } from 'node:fs/promises';

export async function isAnalysisRunner(pid: number, runId: string) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !runId) return false;
  try {
    const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
    const runIndex = args.indexOf('--run-id');
    return args.some(arg => arg.endsWith('/analysis_runner.py')) && runIndex >= 0 && args[runIndex + 1] === runId;
  } catch { return false; }
}
