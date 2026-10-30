// Insert missing debate reports from retained, completed local runs. Dry-run by default.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/apps/web/node_modules/dotenv').config({ path: root + '/.env' });
const sql = require(root + '/apps/web/node_modules/postgres')(process.env.POSTGRES_URL, { max: 1 });
const runs = path.join(require('node:os').homedir(), '.stockdepth', 'logs', 'runs');
const files = [
  ['bull', 'Bull Researcher', 'bull_history.md'],
  ['bear', 'Bear Researcher', 'bear_history.md'],
  ['aggressive', 'Aggressive Risk', 'aggressive_history.md'],
  ['conservative', 'Conservative Risk', 'conservative_history.md'],
  ['neutral', 'Neutral Risk', 'neutral_history.md'],
];
const apply = process.argv.includes('--apply');
(async () => {
  const jobs = await sql`select j.id, j.user_id, j.run_id, r.content as complete_report from analysis_jobs j
    left join analysis_reports r on r.job_id = j.id and r.user_id = j.user_id and r.report_key = 'complete'
    where j.status = 'complete'`;
  const counts = { jobs: 0, missing_runs: 0, recovered_from_complete: 0, candidate_reports: 0, inserted: 0 };
  for (const job of jobs) {
    const run = /^saas-job-[a-zA-Z0-9-]+$/.test(job.run_id) ? path.join(runs, job.run_id) : '';
    const statePath = path.join(run, 'latest_state.json');
    const reports = [];
    if (!run || !fs.existsSync(statePath)) {
      counts.missing_runs++;
      // Old complete reports group replies by speaker; do not invent a timeline.
      // Only extract unambiguous, uniquely marked sections.
      const content = job.complete_report || '';
      const markers = ['### Bull Researcher', '### Bear Researcher', '### Research Manager',
        '### Aggressive Analyst', '### Conservative Analyst', '### Neutral Analyst', '## V. Portfolio Manager Decision'];
      const unique = marker => content.indexOf(marker) >= 0 && content.indexOf(marker) === content.lastIndexOf(marker);
      for (const [key, title, start, end] of [
        ['bull', 'Bull Researcher', markers[0], markers[1]],
        ['bear', 'Bear Researcher', markers[1], markers[2]],
        ['aggressive', 'Aggressive Risk', markers[3], markers[4]],
        ['conservative', 'Conservative Risk', markers[4], markers[5]],
        ['neutral', 'Neutral Risk', markers[5], markers[6]],
      ]) {
        if (!unique(start) || !unique(end)) continue;
        const from = content.indexOf(start) + start.length, to = content.indexOf(end);
        if (to > from && content.slice(from, to).trim()) {
          reports.push({ key, title, name: null, content: content.slice(from, to).trim() });
          counts.recovered_from_complete++;
        }
      }
    } else {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    for (const [key, title, name] of files) {
      const file = path.join(run, 'reports', name);
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        if (content.trim()) reports.push({ key, title, name, content });
      }
    }
    for (const [key, title, field, name] of [
      ['research_debate', 'Research Debate', 'investment_debate_state', 'research_debate.md'],
      ['risk_debate', 'Risk Debate', 'risk_debate_state', 'risk_debate.md'],
    ]) {
      const history = state[field]?.history;
      if (typeof history === 'string' && history.trim()) {
        const formatted = history.trim().replace(/\n(?=(?:Bull|Bear|Aggressive|Conservative|Neutral) Analyst: )/g, '\n\n');
        reports.push({ key, title, name, content: `# ${title}\n\n${formatted}\n` });
      }
    }
    }
    counts.jobs++;
    for (const report of reports) {
      counts.candidate_reports++;
      if (apply) {
        const inserted = await sql`insert into analysis_reports (job_id, user_id, report_key, title, relative_path, content)
          select id, user_id, ${report.key}, ${report.title}, ${report.name}, ${report.content}
          from analysis_jobs where id = ${job.id} and user_id = ${job.user_id} and run_id = ${job.run_id} and status = 'complete'
          on conflict (job_id, report_key) do nothing returning id`;
        counts.inserted += inserted.length;
      }
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...counts }));
  await sql.end();
})().catch(async error => { console.error('Debate backfill failed:', error.code || error.name); await sql.end(); process.exitCode = 1; });
