# Frontend UI results

2026-10-14（北京时间）。Phase0完成；Phase1返修独立验收 **complete**，等待调度器发布并验证远端SHA。未commit/push/部署/重启，未进入Phase2。

| 阶段 | 实际状态 |
| --- | --- |
| 0 | 页面/数据协议审查、合成桌面移动基线截图完成，见 frontend-ui-audit.md |
| 1 | 三旧问题已解决；四处安全英文错误展示、Retry隐私、独立保存回归、tsc、冻结哈希通过 |
| 2–4 | 未开始；后续仅调度器发布验证成功后放行 |

本轮独立执行，以下命令最终退出0，日志均在 var/codex-frontend-team/：

- `node scripts/tests/frontend-experience-stage1.cjs` → stage1-coordinator-repair-experience.log；11分类案例、analysis两区域及请求加载失败、1440/390前后截图，Retry正反例及隐私、管理员诊断保留。
- `node scripts/tests/frontend-admin-stage1.cjs after` → stage1-coordinator-repair-admin.log；18组件断言、三个实际SSR页面×两宽度，ID/操作/provider保留，无原始错误。
- `node scripts/tests/frontend-coordinator-stage1.cjs` → stage1-coordinator-repair-regression.log；实际ModelEditForm/AnalysisUsage浏览器回归，独立保存、其他编辑保留、用户Retry与字段隐藏、管理员诊断、7安全错误案例。
- `node scripts/tests/frontend-admin-model-save-stage1.cjs` → stage1-coordinator-repair-model.log；HEAD含7ae2378，冻结action等于HEAD，updateModelConfig无刷新/导航调用；Mock双表单保存通过。
- `node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false` → stage1-coordinator-repair-tsc.log，成功空日志。
- `git diff --check`、experience/admin原阶段及repair四个回滚补丁 `git apply --check` 均通过；协调两补丁见handoff。

各浏览器无console/runtime错误。自身测试首次固定延时过短导致未挂载form，已仅在自身脚本加入挂载等待并完整重跑通过；没有改产品或他人测试、没有依赖升级。只读publisher AST断言结果 stage1-coordinator-repair-publisher.json，main未调用；全部产品快照hash不变见 stage1-coordinator-repair-integrity.json。

文件/函数与设计：presentError只根据明确异常名或HTTP证据返回固定英文，未知通用；ErrorPresentation限制安全整数Job ID，不拼接原始错误、不新增权限操作。AnalysisClient及AdminOverviewPage/AdminJobsPage/AdminJobDetailPage替换直接错误渲染。AnalysisUsage恢复用户Retry，showDiagnostics保留管理员provider/config/request/完整性。既有ModelConfigForm/ModelEditForm独立保存和隐藏手工限流参数经审查保留；冻结action依赖已发布，不纳入本次。

真实合成截图：stage1-experience-evidence/{before,after}-analysis-{1440,390}.png，stage1-admin-layout-evidence/{before,after}-{overview,jobs,detail}-{1440,390}.png，以及 stage1-experience-evidence/repair-{before,after}-usage-{1440,390}.png。四页16张＋Retry4张。协调本轮查看analysis移动、overview桌面、jobs移动、detail桌面、Retry before桌面/after移动：原始错误消失，安全卡可读，Retry出现且内部字段无展示。管理员移动711/375基线溢出仍存在，Phase3待修；无响应式通过声明。

限制：admin为实际页面/layout SSR，动态usage/cost/report为标注替身，无admin hydration；自身补测实际usage/form。模型保存为Mock action加已提交依赖静态审查，未调用真实DB/action/权限/模型/交易或运行服务。API原始错误仍可能存在，前端隐藏不等于响应安全。全站中文和缓存列留Phase2，模型/角色/报告语言及旧Progress协议保持。

批准清单见 stage1-coordinator.handoff.md 与 receipt.commit_paths（18项），包含前端publisher和全部必需测试；排除actions/API/其他Python/Worker/schema/migrations/凭据/var/log/node_modules。当前远端7ae2378是前置依赖SHA，不是本阶段发布证据。仅调度器普通推送dev并验证本阶段SHA后放行，失败blocked，禁止force。

回滚见handoff：协调原阶段补丁及本轮repair补丁均专用增量，先check；产品先admin后experience，保留初始界面与已发布7ae2378。Phase4最终截图/限制/commit回滚届时补齐，当前未提前操作。

## Phase2 independent acceptance — 2026-10-14 Beijing

Coordinator preserved docs/PLAN and all incoming modified frontend files with SHA256 in `var/codex-frontend-team/stage2-coordinator-before/manifest.json`. Initial-before and completed Phase1 remain intact. HEAD/origin dev both b119d06; HEAD includes 7ae2378. No implementation edits or other-role test edits by coordinator; no commit/push, deployment, restart, real DB/model/trading or later-phase work.

Observed and reviewed: AnalysisClient form/help/loading/pagination/actions/status copy, Activity and deleted-job date display, AnalysisProgress headings/tool controls/result summaries, AnalysisUsage elapsed/timer/table; admin date helpers, costs/details, Jobs/detail deletion labels, Models create/edit/actions feedback and configuration copy. Changes are presentation-only. ErrorPresentation interfaces remain unchanged. Calls, selection values, pricing arithmetic, auth/query/action behavior and report bodies remain unchanged. Historical parseProgress is byte-identical to HEAD; Chinese error markers remain. Whole app/component Chinese inventory contains only protocol markers; frozen server model-test Chinese errors are rendered through fixed safe English presentation. Chinese/English report choices remain.

Actual UI: user table has Agent | Role | Model | Status | Duration | Input | Output | Total Tokens, no Cache Hit column; absent values —, readable Retry; provider/config/request/legacy/standard/completeness hidden from users. Administrator data/diagnostics/cache remain. Viewed synthetic Chromium before/after usage desktop, after progress mobile, saved forms desktop and Models desktop: English labels readable, Chinese/English report content retained, peer unsaved edit visible. Screenshot paths: `stage2-experience-evidence/repair-{before,after}-usage-{1440,390}.png`, `stage2-experience-evidence/{before,after}-progress-{1440,390}.png`, `stage2-admin-layout-evidence/{before,after}-{overview,jobs,detail,models}-{1440,390}.png`, `stage2-admin-layout-interaction-evidence/{before,after}-saved-{1440,390}.png` under var/codex-frontend-team. All synthetic; no real credentials.

Commands independently executed from root; logs under var/codex-frontend-team:

- `node scripts/tests/frontend-admin-stage2.cjs after` → stage2-coordinator-admin.log: exit0, 18 safe error cases and four actual SSR surfaces × desktop/mobile, zero browser errors.
- `node scripts/tests/frontend-admin-model-save-stage2.cjs after` → stage2-coordinator-model-rerun.log: exit0, committed no-refresh action dependency, own-key clearing/peer edits, safe English errors, mock create success and admin costs diagnostics; zero console errors.
- `node scripts/tests/frontend-coordinator-stage2.cjs` → stage2-coordinator-regression.log: exit0; independent hydrated save/peer edit, exact eight headers, Retry/privacy/admin diagnostics, seven safe errors, zero console errors.
- `node scripts/tests/frontend-experience-stage2.cjs` → stage2-coordinator-experience-final.log: exit0, all assertions passed; zero console/runtime errors; desktop/mobile UI, historical progress pairing/content, deleted-job mock restore feedback and errors.
- `node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false` → stage2-coordinator-tsc.log: exit0, empty output.
- Hash/read-only AST checks → stage2-coordinator-integrity.json: incoming product hashes unchanged, tracked frozen business/dependency files equal HEAD, 7ae2378 ancestor, parseProgress unchanged; publisher accepts all 26 reviewed paths and rejects actions/API/DB/Worker/var paths. Publisher reviewed dev guard, explicit staging, no force and remote-SHA verification; not executed.

Initial parallel experience/model browser assertions ran before mounts and failed; model serial rerun passed. An experience rerun was terminated with exit143 and no output; final rerun is separately recorded. Earlier failed logs retained, never presented as passed. Test timing fragility is a remaining limitation; coordinator's own test waits for forms. No foreign tests modified.

Limits: mock SSR/hydration do not prove live authorization, server saves/restore, production dynamic imports or paid execution. AnalysisClient dynamic imports stubbed; standalone progress/Markdown rendering exercised. Existing admin mobile horizontal overflow remains explicitly Phase3; no responsive acceptance claimed. Full menu/keyboard/focus interactions remain Phase4. Raw server errors remain in transport; safe UI is not a backend exposure fix. No added dependencies.

Rollback: `stage2-coordinator.rollback.patch` restores only coordinator docs/PLAN and removes own stage2 test; apply-check only, never applied. Product dedicated patches: stage2-admin-layout.rollback.patch and stage2-experience.rollback.patch, disjoint ownership; apply-check before each, preserve Phase1/7ae2378 and initial UI, no whole-tree reset. Later same-file changes require renewed review. Scheduler alone publishes receipt.commit_paths, ordinary origin/dev push then SHA verification; failure blocked. Stop at current Phase2 gate.
