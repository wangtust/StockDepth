import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { postgresText, runIsolatedTask, workerErrorMessage } from '../../apps/workers/src/worker-resilience';
import { reportMatches, reportValues } from '../../apps/workers/src/analysis-polling';

async function main() {
  const report = { key: 'complete', title: '完整报告\0', relative_path: 'complete\0.md', content: '# NVDA\n中文\0 🚀\n\tend\0' };
  const values = reportValues(report);
  assert.equal(values.content, '# NVDA\n中文 🚀\n\tend');
  assert.equal(values.title, '完整报告');
  assert.equal(values.relativePath, 'complete.md');
  assert(reportMatches(values, report), 'Sanitized reports must not be rewritten on every poll');
  assert.equal(report.content.includes('\0'), true, 'Original runner artifacts stay unchanged');
  assert.equal(postgresText('literal \\u0000 stays'), 'literal \\u0000 stays');

  const root = new Error('invalid byte sequence\0');
  const wrapped = new Error('SQL parameters: PRIVATE REPORT', { cause: root });
  assert.equal(workerErrorMessage(wrapped), 'invalid byte sequence');
  assert.equal(workerErrorMessage(new Error('x'.repeat(5000))).length, 2000);
  root.cause = wrapped;
  assert.doesNotThrow(() => workerErrorMessage(wrapped), 'Cyclic causes must terminate');

  const failures: string[] = [], events: string[] = [];
  const unhandled: unknown[] = [];
  const listener = (error: unknown) => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    await Promise.all([
      runIsolatedTask({
        run: async () => { throw new Error('report write failed\0'); },
        onError: async (error) => { events.push(workerErrorMessage(error)); throw new Error('database offline'); },
        cleanup: async () => { events.push('cleanup'); throw new Error('release failed'); },
        log: (stage, error) => failures.push(`${stage}: ${workerErrorMessage(error)}`),
      }),
      runIsolatedTask({
        run: async () => { await new Promise(resolve => setImmediate(resolve)); events.push('other task completed'); },
        onError: async () => { assert.fail('Healthy task must not fail'); },
        cleanup: async () => { events.push('other lease released'); },
        log: () => { assert.fail('Healthy task must not log errors'); },
      }),
    ]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.deepEqual(failures, ['failure handling: database offline', 'lease cleanup: release failed']);
    assert.deepEqual(events, ['report write failed', 'cleanup', 'other task completed', 'other lease released']);
  } finally {
    process.off('unhandledRejection', listener);
  }

  if (process.argv.includes('--database')) {
    // Only a session-local temporary table is written; no application data changes.
    const postgres = createRequire(new URL('../../apps/workers/package.json', import.meta.url))('postgres');
    assert(process.env.POSTGRES_URL, 'POSTGRES_URL required for --database');
    const sql = postgres(process.env.POSTGRES_URL, { max: 1, onnotice() {} });
    try {
      await sql`create temporary table worker_resilience_test (content text, error_message text)`;
      await assert.rejects(sql`insert into worker_resilience_test(content) values (${report.content})`,
        (error: any) => error.code === '22021');
      await sql`insert into worker_resilience_test(content, error_message) values (${values.content}, ${workerErrorMessage(wrapped)})`;
      const [stored] = await sql`select * from worker_resilience_test`;
      assert.equal(stored.content, values.content);
      assert.equal(stored.error_message.includes('\0'), false);
    } finally {
      await sql.end();
    }
  }
  console.log('PASS: report sanitization, stable comparison, bounded errors, concurrent task isolation, failed error handling and lease cleanup' + (process.argv.includes('--database') ? ', real PostgreSQL round trip' : ''));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
