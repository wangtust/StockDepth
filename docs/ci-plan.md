# GitHub Actions CI engineering execution plan

Date: 2026-10-14 (Asia/Shanghai). Repository wangtust/StockDepth. Work and ordinary publication only on dev. Starting HEAD 8f88572; main stays unchanged.

## Scope and acceptance

Build reproducible CI for Next.js 15/TypeScript, Python 3.11, Node 22, root packageManager pnpm, PostgreSQL 16, Drizzle and Workers. No production DB/services/SSH/user credentials, real LLMs, real trades, deployment or main updates. No ignored failures, continue-on-error, fake success, empty test selection or silent condition skip. Use contents: read, no pull_request_target. Preserve test assertions. Synthetic fixtures, configurable browser, locked dependencies and finally cleanup only.

Actual GitHub execution needs a commit push before its result exists. Coordinator may create explicitly audited validation commits on dev, mark them pending, inspect real workflow/job logs, repair and rerun, then publish evidence/docs. This sequencing is required and must not be described as remote validation before pushing. Every accepted phase has actual run URL, tested SHA, job results and failure-propagation evidence; doc-only followup SHAs must be distinguished from tested source SHAs. No force push. Refuse remote divergence rather than overwriting it.

Tools baseline: gh is not installed/authenticated on the host; no GH_TOKEN/GITHUB_TOKEN configured. Parent verified connected GitHub fetch can read https://api.github.com/repos/wangtust/StockDepth/actions/runs?branch=dev&per_page=1 (currently zero runs). Coordinator must discover available GitHub connector capabilities, particularly generic fetch supporting repository Actions GET; do not rely on fetch_commit_workflow_runs (PR-only wrapper) for push runs. If CLI agents cannot access connector and lack authorized API authentication, record an actual external verification blocker/request in var/codex-ci-team/github-access-request.md, continue independent local work and never declare phase accepted from local tests alone. Do not copy/extract user or app credentials from unrelated accounts/configuration.

## Phases

| Phase | Work | Deliverable | Status |
| --- | --- | --- | --- |
| 0 | Package/workspace/lock/Python/Drizzle/tests audit; path/network/var dependencies and eligible push suites | docs/ci-test-inventory.md; minimal audit workflow if needed to satisfy real-run gate | Accepted: static bootstrap run 38518651341 / source 0c9848e; later suites pending |
| 1 | Clean clone install, Node22/pnpm/Python3.11 locks, unified entry, portable synthetic fixtures/browser, cleanup | reproducible environment and local/remote evidence | Accepted: run38520070810 / source64c5763 / job162s; later phases pending |
| 2 | ci.yml: push dev, PR dev/main, manual; independent Web+Worker type/Python offline/build jobs; caches/timeouts | real jobs and nonempty test reports | Pending |
| 3 | integration.yml: PostgreSQL16 service, migration new/repeat/constraints, atomic claims/lease/crash/recovery/usage/cost/paper idempotency | isolated random DB suites with timeouts/finally cleanup | Pending |
| 4 | Portable frontend entry using existing experience/admin/coordinator fixtures, language/progress/privacy/selection/save/ESC/focus/scroll/races/loading/responsive | actual CI-installed browser regression | Pending |
| 5 | Credential leak/dependency scans; auth/JWT/admin permissions/secret exposure regression; ruleset UI and private plan capability check | actual security results; report product defects for approval before separate fixes | Pending |
| 6 | Layer jobs/caches/cancel/artifact retention/minute budget; actual cost/runtime matrix; one controlled failure then recovered green run | docs/ci-architecture.md, ci-setup.md, ci-results.md, ci-troubleshooting.md | Pending |

Phase0 remote run is audit/bootstrap only, not evidence that future CI suites already work. Actual controlled failure must demonstrably fail a job; restore and obtain a new green run. Failure probe must be intentional and labeled, never mixed into main or hidden. All final required checks must have genuine passing evidence and stable names. Private plan support cannot be guessed; document unknown permissions/account plan when it cannot be read. Provide GUI instructions, do not modify main protection/settings automatically.

## Team ownership

Three CLI agents in tmux codex:
- environment: package manifests and dependency locks, pyproject/test packaging, scripts/ci/env-*; no product logic or test assertion edits.
- tests: existing diagnostics/frontend/Python/Worker tests and fixtures, scripts/ci/test-* and tests; no workflows/manifests/product logic. Retain meaningful assertions and use tracked synthetic fixtures.
- coordinator: .github/workflows, docs/ci-*, PLAN.md; independent acceptance and dev-only Git publication, real run inspection and repairs of its own workflow files. No implementation changes to product code; discovered bugs must be reported for user approval.

Publish interfaces/checkpoints in var/codex-ci-team/stageN-contract.json. No overlapping file writes without explicit handoff. Preserve starting hashes and before copies, explicit staging lists only, no var/log/credentials. Bootstrap local inspections across owners may proceed; stages advance only after coordinator remote acceptance. Tests run in clean temporary clones/workspaces with generated CI env, never load root .env or start application managers that migrate the project DB. Test PostgreSQL must be an isolated container/database separate from app DB.

Bounded supervisor returns ordinary failures to owners up to three repair rounds per phase; quota/auth/external access/permission/required product-fix requests stop instead of consuming retries. Twenty-four hour orchestration and six-hour role limits; STOP terminates team work. Logs/checkpoints retained privately. tmux survives chat disconnect, not reboot; no cron/autostart.

## Execution entry

var/codex-ci-team/team.py and supervisor.py. State/receipts/logs in same directory. Stop by creating var/codex-ci-team/STOP. Phase acceptance receipt must include actual run URL, tested SHA and jobs, plus existing evidence files; actual remote failure cannot be ignored. Coordinator commits validation changes before awaiting real GitHub jobs, then only declares complete when real runs pass. No deployment or main changes.
