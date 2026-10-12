# 2026-10-12 第三轮有限优化验收

本轮按 `optimization-plan-round3-2026-10-12.md` 完成模拟交易并发正确性、持久幂等与任务状态体验，并统一验收部署。没有继续实施收益曲线、交易分页、告警或额外基础设施；前两轮实现仅运行既有回归，未重新优化。

## 完成范围

- 手动交易与 AI 执行统一采用数据库 user SHARE → portfolio UPDATE → decision UPDATE（仅 AI）→ positions UPDATE（按 id）锁顺序。组合行是串行边界，包括不存在的持仓。锁内重读用户有效性、组合归属/状态、现金、持仓与决策状态；Worker 的旧快照只提供身份，不参与金额计算。已执行决策跳过，失败/非法状态拒绝，决策唯一索引另作防御。
- 手动 POST `/api/paper/trades` 接收 UUID `Idempotency-Key`；按用户、组合、键隔离。请求标识、成功 JSON、交易和资产在同一事务持久提交。同键不同有效内容返回 409；新键与无键旧客户端仍可分别成交。成功保持 201 与原 trade/position 字段，不自动重试 POST。
- 金额、数量及 PostgreSQL int4 边界检查；加权成本和 AI 估值使用 BigInt。数据库/幂等结果写入失败回滚，失败不占用键。
- 前端防同 tick 重复提交，网络/解析/冲突不确定时保留原键及原内容供显式重试，成功后换键；编辑内容创建独立操作，成功写入后的刷新失败显示 Saved。分析 queued/running/failed/resume-queued 使用服务器实际状态解释，保留实际错误、Continue、模型和 Token 信息。
- 协调修复 HTTP 公网访问回归：优先使用 `crypto.randomUUID`，不可用时以 `crypto.getRandomValues` 生成 RFC UUID v4，设置版本和变体位。没有弱随机 fallback。
- 协调审查发现另一现金写入路径：组合初始化在取得写锁前检查交易历史，可能覆盖首笔交易后的余额。先在隔离库复现，再让该路径遵循 user SHARE → portfolio UPDATE，锁后检查历史；初始现金同时校验 int4 范围。这是本轮余额正确性的必要补修。

两位执行者完成后协调者才开始验收；未启动额外子智能体。前后端执行者按原分工交付，协调者只补修 UUID helper、组合初始化及独立测试，没有覆盖其并行修改。

## 真实基线与并发结果

全部并发写入位于本轮私有 PostgreSQL 16 集群 `127.0.0.1:55483` 的新建隔离数据库，测试入口确认数据库名/地址/端口及空库后再执行全量迁移。分析夹具为 failed，不能被生产 Worker 领取。测试用 80ms 持仓写入 trigger 放大交错，不是性能或容量测试。

backend 在改动前测得旧错误；协调者另以固定旧提交 `91d9b82e4e7abe6913fc5240d5184631317f95d6` 和原 25 次迁移独立复现：12 案例中 9 个正确性断言失败、3 个通过。基线程序退出 0 只代表完成取证，**不代表基线通过**。

| 隔离用例 | 协调者旧基线 | 当前实现 |
| --- | --- | --- |
| 8 并发超预算买入 | 8 笔、cash -4600、成交 56 股但持仓 7 | 1 笔、cash 300、持仓 7 |
| 可负担并发买入 | 8 笔但持仓只保留 1 股 | 8 笔、持仓 8 股 |
| 同 AI 决策 8 并发及旧快照重放 | 9 笔、cash -8000 | 1 笔、cash 0、持仓 10 |
| 同键不同内容 | 201，产生额外交易 | 409，无额外写入 |
| 两个独立 Node 进程同时提交新键 | 本项为新增验收，无旧测量 | 两次 201、相同 JSON、1 笔、cash 900、持仓 1 |
| 初始化与首笔买入竞争 | 补修前：买入/初始化均 201，cash 被覆盖为 2000 | 补修后：买入 201、初始化 400，cash 900 |

最终协调者新库完整套件 **24/24 断言通过**：买卖/缺失持仓竞争、混合手动与 AI、重复决策、串行/并行键冲突、跨用户/组合键隔离、权限与状态锁后重读、金额/PnL/数量边界、精确成本、两种失败回滚、数据库约束、跨进程竞争及初始化竞争。新 Node 进程持久重放另通过，交易数与资产不变。

## 验证、错误与修复证据

原始记录在忽略目录 `var/codex-team-round3/`，各独立步骤详见 `coordinator.checkpoint.md`。

- `coordinator-baseline.jsonl`：协调者旧 25 迁移基线，真实失败保留。
- `coordinator-concurrency-process-final.jsonl`：新库 26 次迁移、24/24；`coordinator-replay-final.jsonl`：独立进程重放通过。
- `coordinator-reset-before.jsonl`：新增现金覆盖问题的失败证据；最终并发文件包含修复后通过结果。
- `coordinator-upgrade.jsonl`：旧库 25→26、重复迁移、历史资产逐行不变、decision 回填 0、三项 CHECK 保持 NOT VALID。
- `coordinator-init.log`：另一个空隔离库完整初始化及重复初始化，均验证 17 张项目表；`coordinator-init-admin.log`：4/4 管理员初始化回归。
- `coordinator-http-before.log`：修复前 HTTP 提交失败。`coordinator-frontend-http-final.log` 明确断言 `isSecureContext=false`、`randomUUID=undefined`、`getRandomValues=function`；HTTPS 文件断言安全上下文和原生 UUID 可用。两套完整 Playwright mock 均通过 UUID v4、重复提交、显式原内容重试、无自动 POST 重试、成功换键、内容修改、拒绝与刷新失败、分析状态/错误/模型/Token/Continue。不是用 HTTPS 测试替代 HTTP 验收。
- frontend 原 HTTPS-only workaround、同步等待失败等记录保留；协调者未将其初始 HTTP 失败计为通过。
- `coordinator-web-types-final.log`、`coordinator-worker-types-final.log`：web/worker 类型检查通过。`coordinator-build-final.log`：最终生产 build 完成编译、类型检查、26 页生成和 traces；补修前构建没有用于最终验收。
- `coordinator-usage.log`、`coordinator-costs.log`、`coordinator-resume.log`：5+6+3=14 项本地合成 Token/费用/检查点恢复测试通过，无模型调用。
- `coordinator-paper-after.log`、`coordinator-analysis-after.log`：生产只读匿名/跨用户权限、现金/交易 cents、积分、历史 Token/调用、报告和公开费用隔离通过。
- `coordinator-visibility-after.log`：既有权限/隐藏/恢复回归通过；只新建本测试自己的 failed 夹具并清理该 ID，不提交可运行任务、不扣积分、不修改真实用户资产。
- 读取/费用源码回归最初发生模块、路径别名和 `server-only` 条件解析失败，保留失败日志；修正 NODE_PATH、tsconfig 和 react-server 条件后发现旧 `.select()` 测试基准新增 nullable decisionId，而实际读取 DTO 保持原字段。测试首次错误地在实际 DTO 检查该字段，断言失败；改为在旧基准检查历史 decisionId=null 再比较原字段。`coordinator-read-cost-verified.log` 最终通过：原字段/日期/cents、空组合、94 个任务游标无重复、全历史费用聚合差异 0。未更改费用聚合实现或将这些回归耗时描述为第三轮性能收益。
- `coordinator-browser-after.jsonl`：当前生产浏览器只发 GET，真实现金可见、每轮 1 次 paper GET、无 pageerror；管理员导航/筛选和成员权限通过。交易写入仍只在隔离库或 mock 验证。
- `git diff --check` 通过；两处原有未提交文件 SHA256 与交接一致：`admin/actions.ts` 为 `e03b6556a515659985df8bfac738c5babdf7325d249e31601d2e4d278a0128d2`；`admin/models/model-create-form.tsx` 为 `cd25d79a82495570f050e7cbdabb28646a75ed459f361d0caf290e8c23685fc7`。

## 真实部署范围

测试及最终 build 通过后应用 migration 0025。该迁移只新增表、nullable decision FK/唯一索引和未来写入 CHECK，不更新/删除历史资产。生产迁移 25→26，17 张项目表；已有管理员账户和密码保留。生产迁移前后及最终现金/持仓/历史交易规范化哈希均为 `75ef8dfa143880f8903c9b6dc506640f623b140ddd004a00dd7490904b1c0af2`（排除新增 nullable decision_id，仅比较原资产字段）。

web PID `196761 → 226624`，仅在最终构建通过后更新。paper 原本运行；两次只读观察均为活动 analysis=0、running decision=0、可领取 paper run=0，原 paper 进程及子进程没有已建立的非数据库连接，确认空闲后重启，PID `100512 → 227338`。analysis PID `180103`、API PID `74488` 未变。未启动原本未运行的收费服务。

部署/状态证据：`coordinator-production-predeploy.jsonl`、`coordinator-production-migration.log`、`coordinator-production-postmigration.jsonl`、`coordinator-paper-idle-first/second.jsonl`、`coordinator-paper-sockets.jsonl`、`coordinator-deploy-web.log`、`coordinator-deploy-paper.log`、`coordinator-production-final.jsonl`。没有待部署代码。

只解析 `.env` 的 STOCKDEPTH_RUNTIME_BIN；应用工具以已有 web 进程环境执行并禁用 dotenv 读取，未输出环境值、登录凭据或模型密钥。没有调用收费模型、对真实组合下单、删除生产历史数据、Git commit/push/reset/stash/checkout 或全局格式化。私有测试集群结束后关闭，测试数据及证据保留。

## 未完成与风险

本轮有限验收项无剩余待办。没有验证真实收费模型调用或生产交易写入，这是明确的测试边界；不能据隔离测试声称性能、P95、容量或收益改善。

客户端未决操作仅保留在当前组件内，页面已提示保持打开；刷新、关闭或换设备会丢失客户端原键，虽然服务端结果仍持久保存。本轮没有新增浏览器跨页面持久存储。

历史异常资产不清理，CHECK 的历史 VALIDATE 有意不执行；存在历史非法现金/持仓时，交易服务可能拒绝该组合的新写入。历史 trade 的 decision_id 不回填。金额仍是 int4，越界明确拒绝；幂等记录没有 TTL，持续存储；重放仍要求用户与组合有效。

收益曲线、交易分页、告警及其他后续候选未开始。本轮到此停止。
