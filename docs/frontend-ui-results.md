# Frontend UI results

2026-10-14（北京时间）。Phase1/2已由调度器发布并验证 b119d06 / 431349c。Phase3已发布并验证7f2c7bc；Phase4独立验收发现报告内部滚动恢复缺陷，等待supervisor返修；coordinator未commit/push/部署/重启。下文保留各阶段历史记录。

| 阶段 | 实际状态 |
| --- | --- |
| 0 | 页面/数据协议审查、合成桌面移动基线截图完成，见 frontend-ui-audit.md |
| 1 | 三旧问题已解决；四处安全英文错误展示、Retry隐私、独立保存回归、tsc、冻结哈希通过 |
| 2 | 英文展示、用户八列表格、旧协议兼容及独立保存验收通过，已发布431349c |
| 3 | 响应式独立验收通过，已发布7f2c7bc |
| 4 | 独立验收不通过：管理员报告全屏ESC未恢复内部scroll，交回返修 |

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

## Phase3 independent acceptance — 2026-10-14 Beijing

当前HEAD/dev 431349c，与stage2-push.json一致并含7ae2378。先读Phase3两角色contract/checkpoint/handoff/receipt，state为Phase3 repair_round1；无既存协调Phase3交付可恢复，因此从未完成的独立验收开始，未重复Phase1返修或Phase2已完成重构。覆盖前副本/哈希在stage3-coordinator-before/manifest.json；initial-before保持。只更新本报告、frontend-ui-plan、PLAN和两个frontend-coordinator测试，所有incoming产品及其他角色测试字节不变。

审查13个产品文件：AnalysisClient、PortfolioPage仅响应式className；StocksClient/StockDetailClient长标识换行、分页换行及日价表间距/960px局部滚动；AnalysisProgress的1200px时间线/80ch响应/移动gutter及长参数；AnalysisUsage局部760px表、字号行高/行分隔/长模型名；ErrorPresentation只新增overflow-wrap。AdminLayout/AdminNav修复grid intrinsic width与身份栏换行并将shell上限1800→2400px；dashboard Header上限2560px与gap，DashboardLayout保留桌面72/256px折叠并补移动aria/Escape；ModelConfigForm只改Quick/Deep checkbox换行；AdminReportViewer正文80ch；globals.css只新增admin-workspace约束及局部pre/table规则。业务fetch/SWR key/版本/handler、模型角色和语言值、额度/交易/保存逻辑均未改。MarkdownRenderer、DeferredDetails、Progress协议及状态/错误helper等于HEAD。冻结actions.ts等于HEAD，7ae2378是已完成前置，不纳入本次。

真实测量：390px管理员四页before scrollWidth=711/clientWidth=375，after均375/375，nav约677/325局部滚动；五视口无整页横向溢出。用户2560px工作区1800→2400px，报告正文1314→667.375px；1440px报告915→667.375px；移动390px正文316→324px，768px639→655px。Portfolio短positions卡不再沿表单拉伸。代码、宽表留局部横滚。用户八列、Retry及内部字段隐藏、管理员诊断、中文/英文报告内容与选择、中文旧Progress、关闭响应/结果延迟挂载均通过。

协调独立运行命令（根目录），以下最终全部exit0：

- `node scripts/tests/frontend-admin-stage3.cjs after` → stage3-coordinator-admin.log：四实际SSR页×五视口，18安全错误分类回归，移动导航/Jobs表局部横滚，无console错误。
- `node scripts/tests/frontend-coordinator-admin-extra-stage3.cjs after` → stage3-coordinator-admin-extra.log：补充Users/Accounts/Pricing/System实际SSR×五视口，document/nav/table约束；DB/auth/actions/settings/fs/net/os/service-health全Mock，process.env定义为空，没有真实TCP探测或表单提交。stdout及JSON scope继承旧模板措辞较宽，验收仅按真实断言；已修正脚本的输出说明，未重跑不变的布局断言。
- `node scripts/tests/frontend-coordinator-stage3.cjs` → stage3-coordinator-regression-passed.log：组合实际DashboardLayout/AdminReportViewer/MarkdownRenderer，Mock SWR/Next，五视口报告<850px、代码/二十列宽表局部滚动、移动展开/Escape关闭、桌面sidebar宽度，零console/runtime错误。组合为隔离布局探针，不声称真实路由结构/端到端导航。
- `node scripts/tests/frontend-experience-stage3.cjs` → stage3-coordinator-experience.log：独立复验当前真实用户组件，五视口报告/长usage/Progress，延迟挂载、Retry/privacy、八列/管理员诊断、历史中文协议、报告语言、11错误分类及Mock恢复反馈，零console/runtime错误。脚本内置before/after采集，没有重做旧阶段实现。Portfolio/stocks三页×五视口的既有最终未变化验收未重跑，审查脚本/JSON/截图与incoming hash确认有效。
- `node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false` → stage3-coordinator-tsc.log：exit0空日志。
- 只读snapshot/HEAD哈希、ancestor及publisher AST path-validator → stage3-coordinator-integrity.json：24审查路径通过，actions/API/DB/Worker/migrations/env/var/node_modules反例拒绝；没有执行publisher main。
- `git diff --check`及三角色`git apply --check` → stage3-coordinator-diff-check.log / rollback-check.log：通过，未应用。

协调测试首次两列表格可容纳而未触发overflow，修正自身fixture为二十列宽表；第二次发现自身Next Link替身把passHref漏到DOM，过滤该仅Next参数后最终passed。两份失败日志stage3-coordinator-regression.log及regression-final.log保留，未伪装通过；无产品/他人测试变更。补充SSR脚本仅最终stdout/scope说明纠正，不影响已通过断言。

截图在var/codex-frontend-team下：已实际查看admin-layout-evidence/{before,after}-jobs-390.png、after-models-2560.png；experience-evidence/{before,after}-report-content-2560.png及after-report-content-390.png；experience-pages-evidence/after-portfolio-2560.png；coordinator-evidence/after-report-{390,2560}.png；coordinator-admin-extra-evidence/after-system-390.png。全部合成非敏感数据，移动Jobs header及卡片保持页内，大屏报告居中，长词换行；极端二十列探针的列可很窄但滚动仍局部，不能用其布局推断真实报告表格可读性。JSON记录五种指定尺寸，含15px滚动条的clientWidth小于emulated width属正常。

风险/限制：Mock SSR与hydration不证明真实权限、数据库写入、生产Next分块或真实账号菜单。未调用运行服务、真实用户凭据/付费模型/交易；账户/计费/权限表单仅渲染未提交。报告cache/deferred实现字节未改，未新增真实性能收益主张。admin报告加载错误直接error.message为既有旁路，Phase4错误覆盖仍需关注；焦点/全屏modal/状态竞争和完整交互留Phase4，当前不提前修复。三角色before/after evidence详细目录见各handoff。

发布清单为stage3-coordinator-reviewed-paths.json及receipt.commit_paths，共24项：13前端产品、5角色frontend测试、2协调frontend测试、3文档/计划、已修正的前端publisher。发布工具本轮未变化但必须纳入审查；Phase1/2已发布模块无需重复提交。排除actions/API/Python/Worker/schema/migrations/.env/凭据/var/log/node_modules。coordinator不commit/push；调度器普通origin/dev发布并验证本阶段SHA后才放行Phase4，失败blocked，不force。

专用回滚：stage3-coordinator.rollback.patch只还原三文档到协调覆盖前、删除两协调测试；stage3-admin-layout.rollback.patch及stage3-experience.rollback.patch只还原各自Phase3产品/测试，保留Phase1/2、7ae2378、initial-before和其他角色成果。三个补丁apply-check通过且未应用，未来同文件改动须重新check/review；不whole-tree reset。handoff列出全部命令、路径、截图与24项发布清单。

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

## Phase4 initial review history — 2026-10-14 Beijing

以下为返修前历史，blocked及失败结果已由上方最终验收取代；保留问题与全面回归证据。

Phase3已经发布并验证dev 7f2c7bc，HEAD含既有保存依赖7ae2378。读取两角色Phase4 contract/checkpoint/handoff/receipt及计划后独立审查；没有旧协调Phase4交付。incoming产品、他人测试、三文档及publisher覆盖前副本/哈希在stage4-coordinator-before/manifest.json；initial-before保留。coordinator仅写三文档、自身frontend测试及团队证据，没有实现修改或commit/push。

本次验收发现一项确定缺陷 **P4-ADMIN-SCROLL-01**，阶段不通过，交给外层supervisor按既有最多3轮机制返修。AdminReportViewer fullscreen useEffect只记录window.scrollX/Y，没有保存article.scrollTop。实际长报告：进入前article=100px，全屏中改为250px，ESC退出后仍250px，期望恢复100px。外层window=150px确实恢复。独立测试frontend-coordinator-interactions-stage4.cjs使用实际组件和Markdown、mock SWR、长合成段落；最终日志stage4-coordinator-scroll-defect.log退出1，scroll-restoration.json为expected100/actual250，截图after-escape-scroll-defect.png。不要把外层scroll通过当作报告内部scroll通过。首次自身fixture没有足够高度，100px被浏览器夹到0，旧失败日志保留；补足长段落后才得到真实产品缺陷，最后增加退出截图仍复现。

明确返修所有权：仅admin-layout修改admin/jobs/[id]/admin-report-viewer.tsx的article引用与fullscreen effect，保存/恢复原报告内部scrollTop，必要时增加自己frontend-admin测试。不要改业务SWR keys/API/actions或重构其他已完成部分，不修改coordinator测试。修复后运行自身相关测试和coordinator复现命令；协调续轮复验受影响项、tsc、冻结哈希/回滚，不重复未变化整套。experience本轮验收通过部分保持；本发现与7ae2378无关。

逐文件审查9展示源及6角色测试：AnalysisClient任务身份隔离/分页fallback/同步操作锁/pending/status/确认/字段ARIA/全屏inert和恢复；StocksClient/StockDetailClient安全Retry及refresh pending；RecentlyDeletedJobs恢复锁/加载Retry；ErrorPresentation可选Retry契约兼容及client边界；AdminReportViewer安全错误/加载/空态/任务选择/键盘焦点；ModelCostDetails安全Retry/隐藏失败旧rows且保留管理员provider/config/统计；ModelCreateForm同步锁/请求错误form关联；ModelEditForm只ARIA关联并保留独立保存/其他未保存编辑；ModelActionsMenu确认/同步锁/pending成功。API请求签名、业务actions、费用计算、角色/模型/语言值与中文Progress协议保持。发布工具只读审查dev guard、显式路径、无force、远端SHA核验；没有运行main。

独立运行全部Phase4六个角色浏览器套件及Web tsc，命令/耗时/实际exitCode与日志逐项见stage4-coordinator-validation.json。管理员三套覆盖loading/empty/safe Retry/pending、create去重、save/peer edit、deprecate取消/接受、真实SWR旧job晚到及五视口Markdown；experience三套覆盖双submit一次、任务竞态、用户全屏focus/Tab/ESC/inert/内部scroll恢复、原生确认取消、字段错误、八列表格/Retry隐私/管理员诊断/旧中文协议/报告语言、恢复反馈及Portfolio/Stocks/StockDetail五视口。已变化组件必须UI验收，没有用tsc代替。零console/runtime错误仅指这些最终通过套件；新增scroll缺陷断言明确失败。详细最终结果在交接中，不以旧角色receipt代替本轮执行。

截图全合成：stage4-admin-layout-evidence/{before,after}-failure.png显示旧raw路径移除为安全英文Retry卡；stage4-experience-evidence/{before,after}-analysis-390.png及report-content-{390,2560}.png、stage4-experience-pages-evidence/before/after-{portfolio,stocks,stock-detail}-*.png覆盖五视口；stage4-experience-interactions/after-{pending,fullscreen,empty}.png。本轮实际查看管理员failure前后、用户fullscreen、Stocks Retry及协调退出缺陷截图，安全文字/长词换行可见；健康截图相似不代表交互无变化。协调独立复现截图在stage4-coordinator-evidence，完整长报告读宽和局部滚动断言通过，内部scroll恢复不通过。

冻结验证stage4-coordinator-integrity.json：incoming源及其他角色测试哈希不变，231个tracked冻结/依赖文件等于HEAD，7ae2378 ancestor，20个候选发布路径通过publisher实际AST白名单、8类禁止反例拒绝。Phase3未变layout/nav/admin SSR Users/Accounts/Pricing/System及历史验收继续有效，不重跑；本阶段所有更改的客户端及最终用户页面重新验收。Security/Activity真实交互、生产Next chunk/SSR/auth/DB保存/权限/计费/模型/交易不在mock证明范围，未使用真实服务/凭据。客户端去重不是服务器幂等性，native确认为fixture控制，不伪造系统对话框。管理员模型添加实际收费路径完全mock。

候选commit_paths明确记录stage4-coordinator-reviewed-paths.json（20项）：9展示源、6角色测试、1协调测试、3文档及前端publisher。当前 **不批准发布**，不得因有清单而绕过blocked状态。排除actions/API/Python/Worker/schema/migrations/.env/凭据/var/log/node_modules，既有7ae2378不再纳入。返修后重新审查最终hash/清单，只有全部通过才写complete；调度器独自普通push origin/dev并验远端SHA，没有后续Phase或部署。

专用回滚stage4-coordinator.rollback.patch只恢复三文档到本轮before并移除自己的测试；两个角色stage4专用补丁保留Phase1–3、7ae2378、initial-before及并行成果。三份只apply-check不应用，实际结果见stage4-coordinator-checks.json；后续同文件改动需要重新check。禁止whole-tree reset。当前交付blocked receipt为可修复普通UI缺陷，非权限/用量阻塞。
