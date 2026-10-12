// Describe only states supplied by the server; no inferred provider cause or ETA.
export function analysisStatusMessage(job: { status: string; externalStatus?: string | null }) {
  if (job.status === 'queued') return job.externalStatus === 'resume-queued'
    ? '继续请求已排队，等待工作进程接手；将从已保存的检查点恢复。'
    : '任务已排队，等待工作进程接手。';
  if (job.status === 'running') return '任务正在执行，已保存的报告会持续更新。';
  if (job.status === 'failed') return '任务执行失败。已保存的报告仍可查看；可使用 Continue 请求从检查点继续。';
  return '';
}
