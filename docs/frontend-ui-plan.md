# Frontend UI/UX execution plan

Date: 2026-10-14 (Asia/Shanghai). Branch: dev. User authorized phased implementation and normal pushes to origin/dev. No main changes, deployment or service restart.

## Scope and existing work

Read var/codex-frontend-team/user-spec.md for the full requirements. Only frontend pages, components, CSS, pure presentation helpers and frontend tests may change. Freeze Python, Workers, database schema/migrations, business APIs/actions, permissions, model routing, credits, accounting, trading, credentials and .env. No live database/user/model tests or paid calls. Reuse existing tools and dependencies.

Preserve all existing uncommitted changes with before copies and hashes. In particular preserve inline model saving without navigation, hidden manual rate settings, simplified user model labels and historical progress compatibility. Previously authorized admin/actions.ts dependency is independently published in 7ae2378; keep it frozen and exclude it from this round. Frontend changes that existed before this round can be included only after explicit review and validation.

User's earlier explicit preferences take precedence over conflicting generic text in the pasted proposal: ordinary users must not see provider implementation identifiers, configuration IDs, requestKind/legacy, or statistics-incomplete messages. Preserve provider identity and completeness in underlying data and administrator diagnostics. Display missing tokens as — or Unknown, never invented zero. Keep retry indications in readable English. Reports may remain Chinese or English according to the user's choice.

## Sequential stages

| Phase | Work | State |
| --- | --- | --- |
| 0 | Git/remote baseline, page inventory, mock desktop/mobile screenshots, protocol review; docs/frontend-ui-audit.md | Complete; audit and synthetic before/after evidence |
| 1 | Shared safe deterministic ErrorPresentation; all four failure surfaces; no raw traces/paths/secrets; tests | Published and remote SHA verified b119d06 |
| 2 | English static UI; historical Chinese progress parsing remains compatible; Agent/Role/Model split; user Cache Hit column removed | Published and remote SHA verified 431349c |
| 3 | Responsive layouts at 390/768/1440/1920/2560 widths, consistent visual treatment, readable reports and local table scrolling | Independent acceptance complete; scheduler publication/SHA gate pending |
| 4 | Loading/empty/error/retry feedback, modal focus/ESC, state races, accessibility, final browser regression | Queued |

Each phase: preserve before state; test relevant components and TypeScript; document evidence, screenshots and limitations; coordinator reviews explicit frontend-only paths; commit/push dev without force, verify remote SHA, then advance. Failures stop advancement. No whole-tree staging. Final docs/frontend-ui-results.md records commands, actual results, changed files/functions, screenshot paths, remaining risks and rollback per commit. Phase 0 audit is included in Phase 1 publication.

## Three-role execution

- experience: user-facing pages (excluding layout.tsx), analysis-progress, analysis-usage, shared error presentation and pure UI/progress helpers; tests named frontend-experience-*.
- admin-layout: all admin pages/components excluding actions.ts; dashboard/admin layouts and public UI styling; tests named frontend-admin-*.
- coordinator: audit/results/plan, independent review and mock browser tests; only writes docs, PLAN.md and own test files, no implementation edits.

Shared files require a written ownership handoff before editing. No extra agents. Scheduler is var/codex-frontend-team/team.py; tmux codex has frontend-experience, frontend-admin-layout and frontend-coordinator windows. The coordinator runs after both implementation receipts pass, then publication gates the next phase. Each role/phase is bounded to six hours; missing evidence or publishing failure blocks rather than advancing.

Stop: create var/codex-frontend-team/STOP. No cron/autostart is configured; tmux survives chat disconnect but not host reboot. Resume from state/receipts after checking process ownership and preserving records.

## Phase1 coordinator checkpoint — 2026-10-14 Beijing

Initial acceptance found three issues; preserved history is in repair-history and repair-before. Current repair acceptance passes all three, see results and current coordinator handoff. No coordinator commit/push; scheduler must publish approved paths and verify origin/dev SHA before Phase2.

## 2026-10-14 repair continuation

Phase1 acceptance returned three findings. Publisher now permits frontend tests under scripts/tests/frontend-*. Prior authorized model-save action dependency was independently committed/pushed as 7ae2378, with no new action logic; actions.ts stays frozen this round. experience must restore readable Retry, all roles repair and revalidate from preserved receipts. Supervisor returns ordinary failed acceptance to owners for at most three rounds per phase; publication/auth/scope problems stop for review. STOP still halts execution. No deployment/restart.

## Phase3 coordinator acceptance — 2026-10-14 Beijing

Phase2 is published/verified dev 431349c. Both Phase3 deliveries independently reviewed; coordinator preserved incoming sources/tests/docs/publisher with hashes before editing. Five exact viewports passed mock UI acceptance: four core admin pages plus Users/Accounts/Pricing/System, actual dashboard navigation and actual Markdown/report integration; user report/Progress/Usage/privacy/Retry regressions passed. Web tsc, incoming/frozen hashes, explicit 24-path publisher validation and three dedicated rollback checks passed. See results and stage3-coordinator.handoff.md for real logs/screenshots and limitations. Coordinator changed only docs/PLAN and two own frontend tests; no implementation edits, commit/push, live services, real data/model/trading or Phase4. Scheduler alone publishes receipt.commit_paths and verifies origin/dev SHA before releasing Phase4; publication failure blocks.
