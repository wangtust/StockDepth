import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';

export async function testModelConnection(config: {
  provider: string; modelName: string; baseUrl: string; apiKey: string;
}): Promise<{ success?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const runtimeBin = process.env.STOCKDEPTH_RUNTIME_BIN;
    const child = spawn(runtimeBin ? path.join(runtimeBin, 'python') : 'python',
      ['-m', 'stockdepth.api.model_probe'], {
        cwd: path.resolve(process.cwd(), '../api'),
        stdio: ['pipe', 'pipe', 'ignore']
      });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ error: '模型测试超时，请检查网络和服务地址后重试。' });
    }, 35000);
    child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16000); });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve({ error: '无法启动模型测试，请检查服务器 Python 环境。' });
    });
    child.stdin.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timeout);
      try {
        const line = output.split('\n').find((item) => item.startsWith('STOCKDEPTH_PROBE_RESULT='));
        resolve(JSON.parse(line!.slice('STOCKDEPTH_PROBE_RESULT='.length)));
      } catch {
        resolve({ error: '模型测试无法完成，请检查 Provider 和服务器环境。' });
      }
    });
    child.stdin.end(JSON.stringify(config));
  });
}
