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
| 3 | Responsive layouts at 390/768/1440/1920/2560 widths, consistent visual treatment, readable reports and local table scrolling | Published and remote SHA verified 7f2c7bc |
| 4 | Loading/empty/error/retry feedback, modal focus/ESC, state races, accessibility, final browser regression | Complete independent acceptance after scroll repair; scheduler publication / remote SHA pending |

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

## Phase4 coordinator — 2026-10-14 Beijing

Phase3 published/verified 7f2c7bc. Both Phase4 deliveries reviewed and incoming changes preserved. Independent mock UI suites and tsc results are recorded in stage4-coordinator-validation.json. New coordinator browser test reproduced P4-ADMIN-SCROLL-01: admin report article scroll 100→250 stays250 after ESC; window scroll correctly restores150. Return only this defect to admin-layout; coordinator cannot edit implementation. Preserve passed experience/admin changes and unchanged prior coverage. See results/handoff for evidence, candidate paths, limitations and dedicated rollback. Phase4 is not accepted or authorized for publication until repaired and revalidated; no next phase/deployment.

## Phase4 repair final independent acceptance — 北京时间 2026-10-14T11:45:14.526121+08:00

当前 **complete（前端验收通过，等待调度器发布及远端SHA验证）**。此前blocked结论已由本次返修验收取代。只处理P4-ADMIN-SCROLL-01，没有重复重构、创建智能体、改实现/其他角色测试、commit/push或部署。dev HEAD仍为7f2c7bc；冻结保存依赖7ae2378已在HEAD祖先中，不再作为阻塞或提交对象。

先读取当前协调checkpoint/handoff、两角色receipt/checkpoint/handoff、contract及计划。覆盖前最终产品/测试/文档/publisher和协调记录保存于stage4-coordinator-repair-before，hashes.json记录实际SHA256；initial-before及原缺陷日志保持。对比admin-layout修复前源，唯一产品增量为AdminReportViewer的articleRef、全屏effect记录scrollTop/scrollLeft并在cleanup恢复、article挂ref；SWR key/API/权限/费用/模型/角色/语言和中文Progress协议未改。

独立重新执行受影响项，实际命令/耗时/exitCode见stage4-coordinator-repair-validation.json：
- `node scripts/tests/frontend-admin-interactions-stage4.cjs after` → exit0，`var/codex-frontend-team/stage4-coordinator-repair-interactions.log`，7.7s。
- `node scripts/tests/frontend-admin-race-stage4.cjs` → exit0，`var/codex-frontend-team/stage4-coordinator-repair-race.log`，5.26s。
- `node scripts/tests/frontend-coordinator-interactions-stage4.cjs after` → exit0，`var/codex-frontend-team/stage4-coordinator-repair-scroll.log`，8.0s。
- `node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false` → exit0，`var/codex-frontend-team/stage4-coordinator-repair-tsc.log`，7.44s。

全部exit0。原协调断言未改：article100→全屏250→ESC100，window150、焦点/overflow/键盘恢复通过；管理员报告五视口Markdown/宽表/长文本、安全Retry和任务切换通过；真实SWR旧job晚到隔离通过，最终相关浏览器无明显console/runtime错误。Web tsc仅作为类型检查，UI由真实组件隔离浏览器断言验收。14个已验收产品/其他角色测试与原协调快照哈希一致，故复用先前六个完整阶段套件中未受影响项目（命令/日志见stage4-coordinator-validation.json），不重跑未变化项。全部阶段最终证据由原全面验收加此次针对性复验组成。

实际查看真实合成前后截图：返修前stage4-admin-layout-repair-before/coordinator-evidence/after-escape-scroll-defect.png及scroll-restoration.json(expected100/actual250)；本次stage4-coordinator-evidence/after-escape-scroll-defect.png及scroll-restoration.json(expected100/actual100)。正文退出后回到更早的位置，80ch阅读宽度/局部滚动保持。固定截图文件名含defect是原测试命名，不表示当前失败。其余用户页面/反馈、管理员错误及五视口前后截图清单保留在下面历史全面审查记录和两角色handoff中。

stage4-coordinator-repair-integrity.json独立确认231个冻结tracked/依赖文件等于HEAD（含actions.ts），7ae2378 ancestor、14个未变验收文件哈希一致、20个commit_paths通过publisher实际AST白名单及8类禁止反例。当前工作区所有tracked/untracked改动均在审查清单内。publisher只读审查，没有执行main。审查清单包含9展示源、6角色frontend测试、1协调测试、3文档/计划及scripts/diagnostics/push-frontend-dev.py，不含actions/API/Python/Worker/schema/migrations/.env/凭据/var/log/node_modules；前置Phase1–3已发布，不重复纳入业务保存依赖。

风险/限制保持：仅mock浏览器/fixtures，真实DB/auth/权限/费用/模型/交易、生产Next chunk/SSR和Security/Activity真实交互未执行；未访问运行应用、真实用户数据或凭据。客户端去重不证明服务端幂等；native确认用fixture验证取消/接受。无依赖升级、部署或重启。未变Phase3布局/导航/管理员SSR证据继续有效。

专用stage4-coordinator.rollback.patch已按最终三文档重新生成，只恢复到本阶段coordinator-before并删除自身新增frontend-coordinator测试；experience/admin-layout完整阶段补丁和admin-layout repair-only补丁均只撤销对应所有者范围，保留Phase1–3、7ae2378、initial-before及其他角色成果。stage4-coordinator-repair-checks.json记录diff及四份rollback apply-check全部通过，均未应用；未来同文件变化需重新检查，禁止whole-tree reset。

协调仅交付complete receipt和明确commit_paths。调度器才可普通提交/推送origin/dev并核验远端SHA；发布或SHA核验失败必须blocked。此处不宣称已发布，没有后续阶段操作。
