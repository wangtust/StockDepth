import { readFile } from 'fs/promises';
import path from 'path';

export async function managedWorkerStatus(service: 'analysis' | 'paper') {
  try {
    const root = process.env.DOTENV_CONFIG_PATH
      ? path.dirname(path.resolve(process.env.DOTENV_CONFIG_PATH))
      : path.resolve(process.cwd(), '../..');
    const records = JSON.parse(await readFile(path.join(root, 'var/processes.json'), 'utf8'));
    const record = records[service];
    if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.start !== 'string') {
      return 'offline';
    }
    const stat = await readFile(`/proc/${record.pid}/stat`, 'utf8');
    // The process name in parentheses can contain spaces; fields begin after it.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return fields[0] !== 'Z' && fields[0] !== 'X' && fields[19] === record.start
      ? 'healthy'
      : 'offline';
  } catch {
    return 'offline';
  }
}
