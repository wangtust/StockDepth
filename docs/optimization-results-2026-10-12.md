# 2026-10-12 有限优化结果

本轮按 optimization-plan-2026-10-12.md 的三项有限任务完成实现、审查与部署验证。
参考 performance-2026-10-12.md 末尾的生产记录，未把早期开发模式数据当作本轮基线。
没有调用收费模型、执行真实交易、删除真实用户数据、提交或推送 Git，也没有启动子智能体。
原有 analysis-client.tsx、jobs-page-query.ts 模型展示和 admin/actions.ts、model-create-form.tsx
四处未提交改动保留，协调者未编辑这些文件。

## 实际完成

| 计划项 | 完成内容及验收 |
| --- | --- |
| 1. 投资组合共享读取 | 接入按用户隔离的既有 SWR 缓存；queued/running 时每 10 秒刷新，隐藏/离线暂停，完成停止。保留选中项、金额和写入后刷新。成功写入后刷新失败明确提示 Saved，避免把写入误判为失败。失败 DELETE 保留选择，交易 POST 不重试。Playwright mock 与生产页面验证通过。 |
| 2. paper 与管理员查询 | paper 正常路径仍为 7 条 SQL，鉴权后串行阶段由 4 减至 2；模型只读取公开字段，金额及日期字段不变，报告计数改为关联 count，加入 Server-Timing。admin 改为每页 50 条、51 条探测下一页的 ID 游标，保留 status/q 和隐藏任务；每任务费用由两次相关聚合改为一次 lateral numeric SUM / bool_and，保留未知费用和完整性语义。实际查询、费用与分页回归通过。 |
| 3. 协调审查与统一验证 | 修复最近 30 条之外有活动分析时漏轮询：原组合查询加入 EXISTS 活动摘要，不增加 SQL 数量。完整生产构建、web/worker 类型检查及权限/恢复/Token/费用/金额回归通过；生产只读浏览器确认分页导航和筛选保留。结果与限制记录如下。 |

活动摘要作用于当前用户已鉴权并读取的活动组合；详情只使用该组合 ID，不接受客户端指定其他组合。
没有修改分析启动、恢复动作、价格快照、Token/费用聚合逻辑或模拟交易计算。
新响应只多 hasActiveAnalysisRuns 布尔字段；历史展示仍限制为 30 条，交易仍为最近 50 条。

## 测量证据

HTTP 从服务器本机访问，同一诊断选择规则、预热一次后采样三次。运行期间存在数据库网络波动，
不是公网延迟或容量测试。源码比较是函数查询耗时，不包含鉴权/HTTP，不能与 HTTP 行直接同比。

| 指标 | 本轮旧值 | 本轮新值 |
| --- | ---: | ---: |
| coordinator `/api/paper` HTTP 中位数 | 1537 ms（1126–1561） | 1258 ms（995–1524） |
| `/api/paper` 响应 | 19028 B | 19058 B，增加活动摘要 30 B |
| 同轮 SELECT 1 中位数 | 227 ms | 214 ms |
| coordinator 同进程旧/新源码查询中位数 | 1536 ms（1322/1764/1536） | 678 ms（911/670/678） |
| SQL 数量 / 鉴权后串行阶段 | 7 / 4 | 7 / 2 |
| Playwright mock 双挂载初始 GET | 2 | 1 |

backend 较早独立 HTTP 基线为 1122 ms；其最终旧/新源码查询中位数为 1558 / 914 ms。
保留不同轮次，不挑选最好的数值来描述改善；源码比较包含明显长尾。
新 HTTP 已观察到 `auth;dur=214.0, overview;dur=436.1, details;dur=338.7, total;dur=988.9`，
这是最后一个单请求的服务端计时，不是中位数；阶段内部并行操作不能简单相加。

生产 Playwright 预热后新页面三轮真实返回现金金额可见时间为 1450 / 1841 / 1476 ms，
中位数 1476 ms；TTFB 为 444 / 447 / 450 ms，JS transfer 为每轮 224103 B，
每轮 1 次 paper GET，无 pageerror。所有部署浏览器请求均校验为 GET，未点击分析或交易动作。
管理员 Older → Newest 导航与 status/q 链接保留通过。

**生产浏览器没有有效的本轮旧延迟基线。** 第一轮旧页面判据可过早匹配初始化文字，已排除；
改为等待 paper 返回且真实金额可见后的旧部署重测，在生产构建期间等待响应超时，也已排除。
不将该失败归因于业务延迟，不与新页面耗时计算同比。Playwright 原/新客户端的有效比较仅是
隔离 mock 的双挂载 GET 2 → 1。没有采集本轮 k6 或 P95，不沿用上一轮 P95 作为本轮结果。

## 测试与部署

- `bin/stockdepth build`：成功，包含生产编译、完整类型校验、26 页生成和 build traces。
- web `tsc --noEmit --incremental false` 与 worker `check`：通过。
- Python `test_usage.py`、`test_costs.py`、`test_checkpoint_resume.py`：14 项通过；仅本地合成消息、费用和检查点图，无模型调用。
- `paper-read-query.ts`：旧字段、日期、现金/交易金额、公开模型、空组合一致；活动摘要与独立 EXISTS 一致；94 个管理员任务跨页无重复；全历史费用聚合差异 0，complete 筛选逐条费用一致。
- `portfolio-frontend.cjs`：原版双挂载 2 GET，新版 1 GET；活动刷新、列表外活动、后台/离线暂停、焦点恢复、完成停止、用户隔离、现金/选择/ticker 保留、初始失败恢复、交易请求体金额、POST 单次与成功写入后刷新失败反馈通过。
- `paper-http.cjs`：匿名 401；两个真实用户的只读组合/关注/持仓/交易隔离、积分/现金/交易 cents 与数据库一致、公开模型字段及全历史活动摘要通过。
- `analysis-read.cjs`：游标、积分、历史 Token/调用、报告目录与正文一致、普通用户费用隔离通过。
- `job-visibility.cjs`：跨用户权限、幂等隐藏、隐藏重试 409、报告保留、管理员列表/详情、恢复归属/幂等及恢复仍 failed 通过。仅新建 failed 临时夹具，不发起可运行任务、不扣积分；清理仅针对该新建 ID，无真实数据删除。
- `portfolio-browser.cjs`：当前生产只读权限及真实金额显示、无 pageerror、管理员分页/筛选通过。首轮管理员断言早于客户端导航完成而失败；诊断改为等待 URL 后通过，未修改应用导航逻辑。
- `git diff --check`：通过。

构建成功后，仅执行一次 `bin/stockdepth restart web`。启动入口检查现有迁移并验证 16 张表，
已有管理员账户/密码保留；本轮无新增迁移。web PID 从 187506 变为 196761；
analysis 180103、paper 100512 均未改变，没有重启 Worker/API。

原始证据位于忽略的 `var/codex-team/`：backend-baseline.jsonl、backend-source-tests.jsonl、
coordinator-http-before/after.jsonl、coordinator-source-tests.jsonl、coordinator-build.log、
coordinator-mock-baseline.log、coordinator-frontend.log、coordinator-browser-after.jsonl、
coordinator-paper-http.log、coordinator-analysis-read.log、coordinator-visibility.log。
checkpoint 保留失败轮、修复及验收过程，不含会话/凭据/报告正文。

## 限制与结束边界

本轮三项实现和功能验收已完成，未继续扩展为数据库迁移、共享缓存改造或 Worker 优化。
生产浏览器旧延迟基线缺失，无法给出可信浏览器同比；本机少量样本不证明公网性能、稳定 P95、
多人容量或真实收费分析容量。数据库往返仍约 0.21–0.23 秒并有波动；跨地域部署与远程
pg_stat_statements 管理继续属于外部运维事项，本轮没有尝试修改远程数据库或重启它。
真实交易写入后的行为由 mock 验证，没有用真实用户资金做写入回归。
