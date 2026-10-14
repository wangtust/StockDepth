// Describe only states supplied by the server; no inferred provider cause or ETA.
export function analysisStatusMessage(job: { status: string; externalStatus?: string | null }) {
  if (job.status === 'queued') return job.externalStatus === 'resume-queued'
    ? 'Continue request queued. Waiting to resume from the saved checkpoint.'
    : 'Analysis queued. Waiting to start.';
  if (job.status === 'running') return 'Analysis is running. Saved reports will keep updating.';
  if (job.status === 'failed') return 'Analysis failed. Saved reports remain available. Select Continue to resume from the saved checkpoint.';
  return '';
}
