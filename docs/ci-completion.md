# CI 完整实施与发布记录

2026-10-15。用户已授权合并、部署和完成剩余阶段。基础 CI 的 PR #1 已合并到 main，merge SHA `a7d83ba30ccaf6f090e63820f8f146fe1fdbbf7f`。后续工作分支 `ci/complete-checks`。

## 当前实现

- `ci.yml`：main/dev push、目标 main/dev 的 PR、手动触发。独立类型、Python、三组前端、生产构建、数据库集成、安全回归、依赖和历史凭据扫描，最终由 `CI required` 汇总；失败、取消、跳过都不放行。
- `integration.yml`：可复用及手动入口，PostgreSQL16 service 使用动态宿主端口、专用 CI 角色与管理员库；测试拒绝其他地址/角色/库和默认生产端口。每套测试使用随机新库，finally 删除；临时运行目录同样清理。
- 数据库 8 套：空库及升级迁移/重复/约束/积分审计回滚、Worker 稳定性、报告/费用同步、实际 SIGKILL 与租约到期后的新进程恢复、管理员限流竞争、模型替换续跑、密钥迁移/轮换/回滚和保留策略。
- 前端 13 套，admin 7、experience 3、coordinator 3；覆盖用户/管理员错误与隐私、模型表单、SWR 迟到竞态、五视口页面/报告、侧栏、全屏 Escape/焦点/滚动、报告 Markdown、历史进度、取消/删除/恢复及 loading 状态。
- 安全 6 套：密钥认证加密、所有实际 reader 与双模型请求明文出口、管理员密钥写入/脱敏、初始化管理员、JWT 篡改/过期/算法与 Cookie/角色门禁、Worker 读请求重试及写请求不盲目重试。用户/DB/Cookie 夹具明确为合成；不是生产渗透测试。
- Gitleaks 8.30.1 完整 Git 历史扫描，二进制校验固定 SHA256，日志脱敏。唯一例外仅 `.env.example` 中精确无效值 `sk_test_placeholder`，不豁免文件或整个测试目录。额外的生成凭据 canary 已验证：即便在该文件中也会失败且不泄露匹配值。
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

在无应用 .env、无 var 的干净 clone 中使用 Node22.23.3 / pnpm12.11.2 / Python3.11.14。Docker daemon 不可用，使用本机独立 PostgreSQL16 临时集群（loopback55497、专用临时数据目录）；没有接触应用库进行测试。Python 309 passed、1 integration deselected、83 subtests passed；6 安全套件通过；Node high/critical=0，Python无已知漏洞，完整历史凭据扫描通过；actionlint1.7.12通过。生产构建已完成。剩余本轮执行证据随 GitHub 验收补充。

## 远端故障验证及发布

本轮将提交带有明确标识的临时失败 probe 到工作分支，确认真实 job 及 CI required 变红，然后移除 probe 并取得完整绿灯才合并。该 probe 不进入 main，不设置忽略失败。实际 SHA/run/时长待取得后记录，不预先声明验收。

## 合并门禁设置权限

本次读取 rulesets 返回空列表；读取 main branch protection 返回 GitHub App 403 `Resource not accessible by integration`。连接器不提供管理写入能力，不能据此判断用户套餐，也不能声称已强制保护分支。

用户可在仓库 Settings → Rules → Rulesets，为 main/dev 新建规则，要求 PR 且 required status check 为 `CI required`，禁止 force push；先确认该 check 已真实出现。完成后的工作流会生成汇总检查，但 GitHub 只有启用保护规则后才会强制阻止直接合并。账号私有仓库规则能力以界面实际显示为准。
