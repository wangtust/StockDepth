// Configuration snapshots contain encrypted credentials and belong exclusively
// to trusted execution. Worker ownership tokens must also stay server-side.
export function publicAnalysisJob<T extends Record<string, unknown>>(job: T) {
  const { quickConfigSnapshot, deepConfigSnapshot, workerOwner, workerLeaseUntil, ...publicJob } = job;
  return publicJob;
}
