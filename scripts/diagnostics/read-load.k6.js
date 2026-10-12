import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
const jobsLatency = new Trend('jobs_latency', true);
const detailLatency = new Trend('detail_latency', true);
const reportLatency = new Trend('report_latency', true);

// Read-only: never submits analysis jobs or invokes paid models.
export const options = {
  vus: Math.max(1, Math.min(10, Number(__ENV.VUS || 2))),
  duration: `${Math.max(10, Math.min(120, Number(__ENV.DURATION_SECONDS || 20)))}s`,
  thresholds: { http_req_failed: ['rate<0.01'] }
};
export default function () {
  if (!__ENV.SESSION) throw new Error('Set SESSION to a temporary authenticated session cookie.');
  const base = __ENV.BASE_URL || 'http://127.0.0.1:3000';
  const response = http.get(`${base}/api/analysis/jobs`, {
    headers: { Cookie: `session=${__ENV.SESSION}` },
    tags: { endpoint: 'jobs-list' }
  });
  check(response, { 'jobs response succeeds': result => result.status === 200 });
  jobsLatency.add(response.timings.duration);
  if (__ENV.READ_DETAILS === 'true' && response.status === 200) {
    const jobs = response.json().jobs || [];
    const job = jobs.find(value => value.defaultReportKey) || jobs[0];
    if (job) {
      const detail = http.get(`${base}/api/analysis/jobs/${job.id}`, {
        headers: { Cookie: `session=${__ENV.SESSION}` }, tags: { endpoint: 'job-detail' }
      });
      detailLatency.add(detail.timings.duration);
      check(detail, { 'detail response succeeds': result => result.status === 200 });
      if (job.defaultReportKey) {
        const report = http.get(`${base}/api/analysis/jobs/${job.id}?report=${encodeURIComponent(job.defaultReportKey)}`, {
          headers: { Cookie: `session=${__ENV.SESSION}` }, tags: { endpoint: 'job-report' }
        });
        reportLatency.add(report.timings.duration);
        check(report, { 'report response succeeds': result => result.status === 200 });
      }
    }
  }
  sleep(2);
}
