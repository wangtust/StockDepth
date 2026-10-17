# CI 完整实施与发布记录

2026-10-15。用户已授权合并、部署和完成剩余阶段。基础 CI 的 PR #1 已合并到 main，merge SHA `a7d83ba30ccaf6f090e63820f8f146fe1fdbbf7f`。后续工作分支 `ci/complete-checks`。

## 当前实现

- `ci.yml`：main/dev push、目标 main/dev 的 PR、手动触发。独立类型、Python、三组前端、生产构建、数据库集成、安全回归、依赖和历史凭据扫描，最终由 `CI required` 汇总；失败、取消、跳过都不放行。
- `integration.yml`：可复用及手动入口，PostgreSQL16 service 使用动态宿主端口、专用 CI 角色与管理员库；测试拒绝其他地址/角色/库和默认生产端口。每套测试使用随机新库，finally 删除；临时运行目录同样清理。
- 数据库 8 套：空库及升级迁移/重复/约束/积分审计回滚、Worker 稳定性、报告/费用同步、实际 SIGKILL 与租约到期后的新进程恢复、管理员限流竞争、模型替换续跑、密钥迁移/轮换/回滚和保留策略。
- 前端 13 套，admin 7、experience 3、coordinator 3；覆盖用户/管理员错误与隐私、模型表单、SWR 迟到竞态、五视口页面/报告、侧栏、全屏 Escape/焦点/滚动、报告 Markdown、历史进度、取消/删除/恢复及 loading 状态。
- 安全 6 套：密钥认证加密、所有实际 reader 与双模型请求明文出口、管理员密钥写入/脱敏、初始化管理员、JWT 篡改/过期/算法与 Cookie/角色门禁、Worker 读请求重试及写请求不盲目重试。用户/DB/Cookie 夹具明确为合成；不是生产渗透测试。
- Gitleaks 8.30.1 完整 Git 历史扫描，二进制校验固定 SHA256，日志脱敏。例外仅 `.env.example` 和本文扫描说明中的精确无效值 `sk_test_placeholder`，不豁免整个文件或测试目录。额外的生成凭据 canary 已验证：即便在该文件中也会失败且不泄露匹配值。
- pnpm audit：high/critical 必须失败；pip-audit 2.10.1：完整哈希锁清单中的任何已知漏洞均失败，查询服务异常同样失败。现 Node 仍有 1 条 moderate 记录，不符合 high 门禁条件，不声称所有级别清零。
- 官方 Actions 固定提交 SHA；依赖缓存只有下载/store，安装仍 frozen/hash；同事件同 PR/ref 取消过期任务；job 有超时。Python JUnit 和前端/数据库/安全 JSON 报告保留 7 天，不上传 .env、应用日志或真实数据。
- phase0/phase1 保留手动入口，停止重复自动运行。

## 安全依赖修复

真实扫描发现并修复：Drizzle ORM 0.43.1 → 0.45.2；sharp 间接依赖固定 0.35.5；所有 PostCSS 固定 8.5.29；pytest 8.4.2 → 9.0.3、wheel 0.45.1 → 0.46.2，Python 锁仅更新这两个包及必要元数据。root pnpm lock 是安装权威；apps/web 的历史独立 lock 不用于 CI。

依据：[Drizzle advisory](https://github.com/advisories/GHSA-gpj5-g38j-94v9)、[sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[PostCSS advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849)。依赖修复后执行真实 PostgreSQL16 回归、生产构建、类型和浏览器测试。

## 历史测试移植边界

保留旧 Phase1/2、Stage3 experience 等历史对比脚本；每个页面/行为选择最新版本进 CI，避免让旧中文/英文基线要求互相冲突。新增显式 `after` 模式仅检查当前跟踪源码，无参仍可做历史比较。已移除两处未跟踪的团队发布回执依赖；不是伪造旧 receipt。阶段后续增加的双模型 payload、事务初始化、配额恢复 action、历史决策 API 使用相应真实签名更新夹具。

界面当前有少量已发布的中文功能文案；测试只精确允许这些既有文案，仍拒绝其他中文泄漏/原始错误。Stocks 页面标题按现产品 `Stock` 验证。业务断言仍覆盖响应宽度、原始错误缺席、权限、费用、调用次数、lease fencing 和幂等，不以删除业务断言获取绿灯。

## 本地验收

在无应用 .env、无 var 的干净 clone 中使用 Node22.23.3 / pnpm12.11.2 / Python3.11.14。Docker daemon 不可用，使用本机独立 PostgreSQL16 临时集群（loopback55497、专用临时数据目录）；没有接触应用库进行测试。Python 309 passed、1 integration deselected、83 subtests passed；6 安全套件通过；Node high/critical=0，Python无已知漏洞，完整历史凭据扫描通过；actionlint1.7.12通过。生产构建已完成。完整远端验收见下方。

## 远端故障验证及发布

已完成工作分支临时失败演练、恢复绿灯、合并及部署。main 最终工作流不含失败 probe；Git 保留演练提交的审计历史，未忽略失败。实际 SHA/run/时长见下方验收。

## 合并门禁设置权限

本次读取 rulesets 返回空列表；读取 main branch protection 返回 GitHub App 403 `Resource not accessible by integration`。连接器不提供管理写入能力，不能据此判断用户套餐，也不能声称已强制保护分支。

用户可在仓库 Settings → Rules → Rulesets，为 main/dev 新建规则，要求 PR 且 required status check 为 `CI required`，禁止 force push；先确认该 check 已真实出现。完成后的工作流会生成汇总检查，但 GitHub 只有启用保护规则后才会强制阻止直接合并。账号私有仓库规则能力以界面实际显示为准。


### 首次云端失败与修复

工作分支提交 `ca2aef82545e764c7b41ddcd052ff699d261c517` 的 [run 38706000895](https://github.com/wangtust/StockDepth/actions/runs/38706000895) 中，Type checks 的临时 probe 按设计退出 42。首次运行同时发现云端差异：隐藏的报告目录被 artifact 默认排除、数据库测试将容器内部端口误认为宿主映射端口，以及本文占位符说明也触发了历史扫描。修复为非隐藏专用报告目录、核验同一服务的实际地址/端口及 CI 角色/库身份、对文档中同一精确无效占位符增加限路径例外。未忽略失败，也未降低报告缺失/凭据检查门禁。


临时 probe run 已实际结束为 failure，`CI required` 退出 1 并列出所有失败依赖，证明失败传播真实生效。Coordinator 的附加 SSR 套件在云端首次出现 180 秒超时；新增渲染阶段日志及 CDP 请求 15 秒超时，用于定位而非放宽断言或增加总时限。恢复版移除临时 exit42，仍要求全部任务通过。


## 最终验收与部署

| 项目 | 实际证据 |
| --- | --- |
| 失败演练 | [run 38706000895](https://github.com/wangtust/StockDepth/actions/runs/38706000895)，source `ca2aef82545e764c7b41ddcd052ff699d261c517`；Type checks exit42、CI required exit1 |
| 恢复绿灯 | [run 38706637161](https://github.com/wangtust/StockDepth/actions/runs/38706637161)，source `33be4be9f2f798592f94cdb5599dc7dbea18c4ba`；11 job 全 success；6 个非空报告 artifact |
| 合并 | [PR #2](https://github.com/wangtust/StockDepth/pull/2) 已合并；main merge SHA `202e63dbe6f8ee6501e0a6173cad210611a04ee7` |
| main push 验收 | [run 38707075289](https://github.com/wangtust/StockDepth/actions/runs/38707075289)，上述 merge SHA；11 job 全 success |
| 应用发布 | 同一 merge SHA；frozen install、真实生产配置 build、Web/analysis/market 启动通过；数据库初始化确认 40 条迁移已应用、28 表就绪，没有待迁移结构 |
| 发布后只读检查 | sign-in 200；dashboard 307；analysis API 401；真实 admin details API 403；后端 options API 401 |
| 已加载依赖 | Drizzle0.45.2、PostCSS8.5.29、sharp0.35.5 |
| 清理 | 本地临时 PostgreSQL16 停止前确认没有遗留套件数据库；临时副本/venv删除；回滚构建和依赖保留于忽略目录 `var/ci-release-20261015` |

发布前再次确认 analysis queued/running=0、paper claimed/submitted=0，先停止 Web 接收新 UI 工作，再确认空闲并停止相关 Worker；保留旧依赖及构建后进行安装/构建，成功后启动。原 API 正常运行，paper 原本未启动，未擅自启用自动交易。没有调用真实模型或创建交易进行验收。初次只读 smoke 使用了不存在的 admin collection 路径而得到404，已改为实际 admin details 路由并得到预期403；不是忽略服务故障。

本机证据：`var/ci-completion/`、`var/ci-release-20261015/deployment.log`、readiness.json、dependency-versions.json。证据文档后续提交与已测试 source SHA 分列，不将文档提交冒称原 tested source。

### 耗时与预算

恢复 run 的实际 job 时长：security23s、types36s、Python72s、secret8s、experience140s、audit38s、build79s、admin107s、coordinator68s、PG16集成61s、required2s；共634 job秒（约10.6 job分钟），并行执行。所有 job 超时上限之和102分钟，仅为异常情况下的硬上限。实际账单/套餐不可读取，不由执行时间推算收费金额。报告保留7天；避免重复旧 workflow；取消过期同事件运行。没有付费模型测试。

首轮 coordinator SSR 超时尚无确定根因；新增阶段日志及15秒CDP超时后，恢复 run 和 main run 连续通过，未增加180秒套件总时限或删除断言。

代码、运行验收和应用部署均已完成。唯一管理权限事项是分支保护强制启用：当前连接器403且无写入能力，必须由有权限的仓库管理员在界面设置；不能将生成 `CI required` 等同于已经启用强制保护。
