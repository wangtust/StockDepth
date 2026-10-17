import 'server-only';
import { decryptModelKey } from '@/lib/security/model-key';
import { spawn } from 'node:child_process';
import path from 'node:path';

export async function testModelConnection(config: {
  provider: string; modelName: string; baseUrl: string; apiKey: string;
}): Promise<{ success?: boolean; error?: string }> {
  let apiKey: string;
  try { apiKey = decryptModelKey(config.apiKey); }
  catch { return { error: 'Model credentials are unavailable. Ask an administrator to check the encryption configuration.' }; }
  const childEnv = { ...process.env };
  delete childEnv.STOCKDEPTH_MODEL_KEYRING;
  delete childEnv.STOCKDEPTH_MODEL_KEY_ID;
  return new Promise((resolve) => {
    const runtimeBin = process.env.STOCKDEPTH_RUNTIME_BIN;
    const child = spawn(runtimeBin ? path.join(runtimeBin, 'python') : 'python',
      ['-m', 'stockdepth.api.model_probe'], {
        cwd: path.resolve(process.cwd(), '../api'),
        stdio: ['pipe', 'pipe', 'ignore'],
        env: childEnv
      });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ error: 'The model test timed out. Check the network and service URL, then try again.' });
    }, 35000);
    child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16000); });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve({ error: 'Could not start the model test. Check the server Python environment.' });
    });
    child.stdin.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timeout);
      try {
        const line = output.split('\n').find((item) => item.startsWith('STOCKDEPTH_PROBE_RESULT='));
        resolve(JSON.parse(line!.slice('STOCKDEPTH_PROBE_RESULT='.length)));
      } catch {
        resolve({ error: 'Could not complete the model test. Check the provider and server environment.' });
      }
    });
    child.stdin.end(JSON.stringify({ ...config, apiKey }));
  });
}
