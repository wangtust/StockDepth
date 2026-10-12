export async function registerNodeTracing() {
  if (process.env.STOCKDEPTH_TRACE_LOCAL !== 'true') return;
  const { registerOTel } = await import('@vercel/otel');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.resolve(process.cwd(), '../../var/performance-spans.jsonl');
  registerOTel({
    serviceName: 'stockdepth-web',
    traceExporter: {
      export(spans, callback) {
        const rows = spans.map(span => JSON.stringify({
          traceId: span.spanContext().traceId,
          name: span.name,
          durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
          status: span.status.code,
          timestamp: new Date().toISOString()
        })).join('\n');
        fs.stat(file).catch(() => null).then(stat => {
          return fs.writeFile(file, rows + '\n', { flag: stat && stat.size > 5_000_000 ? 'w' : 'a', mode: 0o600 });
        }).then(() => callback({ code: 0 }), () => callback({ code: 1 }));
      },
      async shutdown() {}
    }
  });
}
