# Frontend Phase0 audit

2026-10-14 北京时间。Coordinator；dev HEAD 与只读 `git ls-remote origin refs/heads/dev` 均为 d413d95873865d4891ac6cb7d01eaea222c3e4ad。共享工作区存在未提交修改，因此未执行 pull/merge；没有提交、推送、部署、服务重启或新建智能体。

初始基线为 `var/codex-frontend-team/initial-before`、`initial-hashes.json`、`initial.diff`。本角色覆盖前文档副本/哈希/Git状态为 `stage1-coordinator-before/`。两角色的 before 副本包含已有界面修改，不能用 HEAD 覆盖它们。

| 页面/函数 | 基线问题和数据协议 | Phase1实际结果 |
| --- | --- | --- |
| analysis-client.tsx / AnalysisClient | job.errorMessage string/null，列表与选中任务直接渲染；请求错误及列表加载错误也直接显示 | 共享安全英文展示，failed 无错误也显示通用提示；操作 handler/轮询不变 |
| admin/page.tsx / AdminOverviewPage | Recent Failures 插值 errorMessage | 安全卡片，Job ID/owner/ticker保留 |
| admin/jobs/page.tsx / AdminJobsPage | Error 列插值 errorMessage | 安全卡片；既有 Retry/Cancel/View Report保留 |
| admin/jobs/[id]/page.tsx / AdminJobDetailPage | pre 显示原始全文 | 安全卡片；管理员 provider/PID/费用诊断保留 |

页面清单另见 `var/codex-frontend-team/stage1-experience-page-inventory.txt`：用户 Dashboard、Analysis、Stocks、Portfolio、Account/general、Security、Activity；管理员 Overview、Jobs/detail、Models、Users、Accounts、Pricing、System；root/dashboard/admin layouts、公共 UI/CSS。此清单是后续阶段覆盖范围，不表示所有页面已浏览器验收。

协议审查：Progress 的 `模型回复`、`工具结果：` 是历史解析协议，保持原样。UsageJob/UsageCall 的供应商、配置 ID、requestKind、cache token 与完整性数据没有删除，普通用户隐藏内部字段、管理员开启 showDiagnostics；未知 token 显示 —/未知而非零。Chinese/English 报告及 Quick/Deep 选择、权限、存储、API、action/查询保持。本阶段只分类明确异常名/HTTP证据，其他错误固定通用文案；不插入原始输入。分类误报/格式变化风险由保守识别控制，但没有证明所有潜在字符串格式都可识别。

实际基线截图包含合成 Traceback、虚构 /srv/private 路径及无效 synthetic key。四页面×1440/390 的前后PNG在团队 evidence 目录，见 results。Coordinator查看 analysis移动、overview桌面、jobs移动、detail桌面修改后截图；确认安全错误卡及现有移动溢出。管理员390视口已有 scrollWidth 711 / clientWidth 375，错误列可能在可视区域之外；Phase3待修，不能宣称响应式通过。动态报告/费用小组件被标注 Mock，admin为SSR无hydration；未验证真实权限/action/DB或真实报告性能。

初轮发现的范围外/前置问题（历史结论，返修状态见下）：API仍携带原始错误，前端隐藏无法消除响应级泄漏；models/model-edit-form.tsx 独立保存依赖被冻结 actions.ts 去除 revalidateAdmin，干净提交不能证明服务端重验证后其他编辑保留；analysis-usage.tsx 已有修改隐藏用户 isRetry 标记，不符合可读英文重试偏好。上述均保留，未越权改实现。

初轮发布阻塞（已解决）：scripts/diagnostics/push-frontend-dev.py 白名单只允许 apps/web、docs、PLAN 和指定 diagnostics，拒绝 scripts/tests/frontend-*；且它是Python文件，本轮禁止纳入commit_paths。调度器硬编码调用此脚本。需要发布工具所有者明确书面交接/修复后复验，本角色只记录问题。

## Phase1 返修审查 — 2026-10-14 北京时间

当前 HEAD 与只读 origin/dev 查询均为 7ae2378d5b1a89076ad55e42607f7ea35b4a90c9。三旧问题已解决：用户 isRetry 显示英文 Retry 且 provider/config/request/completeness 仍隐藏；updateModelConfig 独立保存依赖已单独发布且冻结文件等于 HEAD；发布工具允许 scripts/tests/frontend-*，已只读执行 AST 白名单断言，拒绝 actions/API/runtime/credentials 路径，不执行发布函数。该明确授权的发布工具例外纳入审查，未修改 Python。

coordinator返修快照 stage1-coordinator-repair-before/hashes.json；全部已跟踪产品文件在本轮协调审查期间哈希不变，见 stage1-coordinator-repair-integrity.json。前置 models/model-edit-form、模型选择标签、usage/showDiagnostics 均审查保留。Chinese Progress 协议、模型/角色/报告语言选择保留，未修改实现。新增admin独立保存测试纳入清单。当前安全展示验收通过；响应级原始错误风险及移动溢出仍如上，仅本阶段前端展示通过。

## Phase2 recheck — 2026-10-14 Beijing

Static Chinese UI/date/call-table findings addressed and independently reviewed; historical Chinese parser/report content preserved. User Retry/privacy and administrator diagnostics preserved. No new business/API defects modified. Actual mock UI and residual mobile overflow limits: see frontend-ui-results Phase2.
