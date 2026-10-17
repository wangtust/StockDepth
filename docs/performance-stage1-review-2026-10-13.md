# 性能与稳定性第一阶段：审查、基线与实施计划

本次交付仅包括审查、只读基线测量及第一阶段实施计划。尚未修改业务代码、迁移数据库、重启服务、提交 Git commit 或实施第二至第四阶段。所有 HTTP 请求均为读取，没有提交分析、调用收费模型或执行交易。

## 工作区与测量边界

- 分支为 `dev`，HEAD 为 `438ef36`；已有 27 个已跟踪文件被修改，7 个双模型相关文件未跟踪。没有覆盖这些内容。
- 审查前后业务文件的 `git diff HEAD` SHA-256 均为 `c62c1a7ea0dd2bc6d7bf4473d318d8e0666bbd992ec1e4e1eacc7455c0e9d76b`。7 个原有未跟踪文件的指纹另存 `source-manifest.json`。
- 现有 Web/API/Analysis/Market/Paper 五个服务继续运行。Web 使用已有 Next.js 生产构建。本轮没有重新构建或部署。
- 数据库查询使用已有本地库，只执行读取；新增基线脚本将连接设置为 `default_transaction_read_only=on`。现有 diagnostics 的已运行部分也经审查，只含 SELECT/EXPLAIN 及 HTTP GET。
- 测量时没有 queued/running 分析任务，资源数据是轻量读取场景，不能推断真实模型执行容量。
- 本次新增文件仅为本报告和 `scripts/diagnostics/stage1-baseline.cjs`；原始测量保存于被 Git 忽略的 `var/performance/stage1-baseline-2026-10-13/`。

## 基线结果

时间：2026-10-13 09:53 UTC。请求从服务器本机发出，使用内存中的临时认证会话，不保存或打印凭据。每个接口每轮先预热一次，再顺序测量 30 次；共两轮、300 个计入统计的 HTTP 请求，全部返回 200。每轮 DB RTT 测量 100 次。p50/p95 使用排序后 nearest-rank，不是平均值。没有执行并发压测或浏览器测试。

| 项目 | 第一轮 p50 / p95（ms） | 第二轮 p50 / p95（ms） | 响应大小 |
| --- | ---: | ---: | ---: |
| 分析页面 HTML | 23.708 / 41.975 | 22.073 / 29.737 | 91,714 B |
| 任务列表接口 | 6.176 / 8.173 | 4.922 / 6.069 | 11,197 B |
| 任务详情摘要接口 | 5.194 / 7.823 | 5.093 / 7.158 | 8,390 B |
| 单份报告正文接口 | 6.855 / 14.978 | 6.400 / 14.148 | 134,640 B |
| Python `/api/options` | 1.179 / 4.579 | 1.155 / 1.850 | 11,411 B |
| PostgreSQL `SELECT 1` RTT | 0.073 / 0.183 | 0.071 / 0.164 | — |

现有 `latency.cjs` 另测十次：页面中位数 36 ms，列表与摘要接口均为 6 ms；列表基础 SQL 的 EXPLAIN 服务端执行 0.128 ms。`database-stats.cjs` 确认没有安装 `pg_stat_statements`；本轮没有修改数据库扩展或全局配置。该基础 SQL 不等于完整列表接口查询。

资源采样 20.06 秒，1 秒一个样本；按服务进程树合计 RSS：

| 服务 | RSS 范围（MiB） | CPU（单核百分比） | 采样期间磁盘读 / 写 |
| --- | ---: | ---: | ---: |
| Web | 263.02–320.35 | 14.06% | 36,864 / 274,432 B |
| Python API | 75.78–75.95 | 0.15% | 0 / 4,096 B |
| Analysis Worker | 146.20–146.36 | 0.50% | 0 / 0 B |
| Market Worker | 126.36 | 0.05% | 0 / 0 B |
| Paper Worker | 146.61–146.71 | 0.15% | 0 / 0 B |

机器有 2 个逻辑 CPU，总内存 3,813.99 MiB；最低可用内存 2,488.88 MiB，swap 使用 209.70 MiB。整机 CPU 平均忙碌 11.23%，包含诊断脚本和其他进程。RSS 可能重复计算共享页，不能当作独占内存；Web RSS 的短时增加不能据此断言内存泄漏。磁盘计数来自 `/proc/<pid>/io`，不代表全部文件系统调用数量或缓存命中读取的流量。

按当前 `memorySnapshot()` 的读取顺序复测全量 `/proc` 扫描十次：每次读取约 184 个进程的 cmdline；p50 26.803 ms，p95 36.495 ms，当时没有 Python runner。它不是当前读取接口的主要瓶颈，但在快速任务结束时仍会反复发生。

只读汇总旧调用记录：153 条调用中 151 条具备完整成功调用起止时间，时间范围为 2026-10-12 11:27–16:53 UTC。Bear Researcher 的单次模型调用 p50/p95 为 88.387/355.524 秒；Conservative Analyst 为 61.690/297.790 秒；Neutral Analyst 为 58.495/280.182 秒。这是既有历史数据，均标为 legacy，不能归因于当前双模型组合，也不包括整个 Agent、工具或报告写入的耗时。本轮没有收费模型测试，不能给出新的完整分析耗时或最慢 Agent 排名。

## 已确认问题与证据

| 优先级 | 发现及证据 | 涉及文件 / 函数 | 本轮判断 |
| --- | --- | --- | --- |
| P0 | 恢复启动对全部 running 任务直接 `trackJob()`，随后才进入带容量限制的正常调度循环 | `apps/workers/src/analysis-worker.ts`：`main()`、`recoverRunningJobs()`、`trackJob()` | 重启可同时触发过多恢复调用；仅观察已有 runner 与重新启动 runner 要分别处理 |
| P0 | Paper 领取只有 SELECT/LIMIT，既不改状态也不持有跨请求的所有权 | `apps/workers/src/paper-trader-worker.ts`：`claimNextRun()`、`processRun()` | 两个进程可选中同一 run；结果表唯一索引/`onConflictDoNothing()` 只防重复入库，不能防此前两次模型请求 |
| P0 | Python UsageRecorder 已返回 role/config ID/provider，Worker 的 `syncUsage()` values 中没有这三列 | `apps/api/stockdepth/api/usage.py`：`on_chat_model_start()`；`apps/workers/src/analysis-worker.ts`：`syncUsage()` | 双模型身份记录已有缺口，优化前必须补齐并做兼容回归；这不是新增选择需求 |
| P1 | `JOBS` 长期保留 Popen，退出仅在查询状态或再次启动同 key 时 poll；没有统一回收机制 | `apps/api/stockdepth/api/server.py`：`JOBS`、`run_status()`、`Handler.do_POST()` | 未证明当前已有僵尸泄漏，但存在回收时机不稳定和容器字典增长风险 |
| P1 | `run_status()` 没有检查非零 returncode，而 runner 顶层异常打印 `Analysis failed:`，不一定命中旧日志关键字 | `server.py`：`run_status()`；`analysis_runner.py`：顶层异常处理 | 某些失败可能被判为 partial/empty，甚至因已有决策文件判为 complete，导致错误结束或无效轮询 |
| P1 | ThreadingHTTPServer 下，同 key 的检查与 Popen 创建之间没有锁 | `server.py`：`Handler.do_POST()` | 并发启动请求存在重复子进程风险，需隔离复现验证 |
| P1 | 每轮主循环都调用全量 `/proc` 扫描；30 秒条件只控制指标日志 | `analysis-worker.ts`：`memorySnapshot()`、`main()` | 有限时长缓存和已知 PID 采样可减少扫描，不应去掉低内存保护 |
| P1 | Web runner 只有模型调用起止 UTC 时间，没有完整 Agent/工具/写报告的单调时钟耗时 | `analysis_runner.py`、`usage.py`、`workflows/setup.py` | 现有 `AnalystWallTimeTracker` 主要接入 CLI，不能替代 Web 执行路径的分段测量 |
| 已有 | Paper HTTP 请求已配置 `AbortSignal.timeout(60_000)` | `paper-trader-worker.ts`：`callDecisionModel()` | 保留，不重复实现；只补挂起响应和响应体超时的 Mock 回归 |
| 已有 | Worker 已按报告签名变化保存，usage 已按签名和 call ID 增量 upsert | `analysis-worker.ts`：`processJob()`、`syncUsage()` | 保留；全量正文传输和报告写入策略属于第二阶段，本轮不改 |
| 已有 | Python 报告文件已有临时文件 + replace，Checkpoint 已启用 | `analysis_runner.py`：`write_text()`、`main()` | 新增计时只包裹现有调用，保持写入和恢复语义 |

另一个诊断工具问题：`scripts/diagnostics/worker-capacity.cjs` 硬编码新库应有 16 张表，而当前迁移初始化已有 24 张表；Mock job 立即完成也不足以可靠采样恢复并发峰值。本轮没有运行该脚本，计划先修正测试夹具再用于第一阶段验收。

以上 Worker 竞态/恢复问题来自源码审查；没有在真实任务上触发重启或并发复现。

## 第一阶段实施顺序与设计

### 1. 先保护双模型记录与建立分段计时

在 `analysis-worker.ts::syncUsage()` 补写既有的 role、modelConfigId、provider 字段；不重算已有费用，不改历史模型价格。新增性能回调模块接入 `analysis_runner.py`，与 UsageRecorder 并列，不混用性能数据与费用记录。

用 `perf_counter_ns()` 测量模型、工具和 Agent 节点，UTC 仅用于跨进程关联。通过 callback 的 run ID/parent ID、langgraph_node 建立父子关系，避免把嵌套 Runnable 的时长重复汇总为多个 Agent。对成功、异常、取消、重试分别结束计时；对报告写入在现有 `write_text()` 外围计时，第一阶段不改变写入次数或内容。

事件仅包含任务/run/call ID、角色、模型配置 ID、节点/工具名、状态、耗时、字节数；不记录输入、输出、工具参数、报告正文、密钥或认证头。采用可关闭、容量有界的独立事件输出与摘要，测量其自身 I/O 和 CPU 开销；Checkpoint 不携带回调对象。网络供应商 SDK 的内部重试若没有逐次事件，明确标注观测范围，不能冒充逐 HTTP attempt 统计。

### 2. 限制恢复启动并发，明确运行所有权

将恢复任务先放入待恢复队列，按同一 admission 规则启动，包括本机、用户、Quick/Deep 涉及供应商和资源上限。已存活的 runner 先接管监控并计入资源占用；超过新配置上限时停止增加启动，不直接杀死真实任务。需要重新创建子进程的恢复任务才消耗新的启动配额。

跨 Worker 恢复通过数据库 lease/owner token 原子取得所有权，只有所有者可以启动/续租/结束任务；旧实例的过期回调不能覆盖新实例状态。新增必要的规范 Drizzle 迁移，兼容没有 ownership 信息的旧任务。测试和迁移验证仅使用临时库。

### 3. Paper 原子领取与失败恢复

在 `paper_analysis_runs` 增加领取状态、owner token、lease/提交标记等必要调度字段，在短事务内 `FOR UPDATE SKIP LOCKED` + 条件 UPDATE 领取；提交事务后才发模型请求，避免长时间持有数据库事务或连接锁。后续写结果验证 owner token，沿用既有唯一索引。

崩溃发生在外部请求已发送后，数据库与供应商之间无法保证严格 exactly-once。明确区分“未提交请求、可回收”与“已提交但结果未知、禁止自动再收费调用”；后者保留异常状态和调用标识，不因 lease 过期直接重试。测试覆盖领取后、提交后、回复后但结果写入前的退出位置。不保存新的提示词或凭据。

`callDecisionModel()` 的 60 秒超时保持。用本地 Mock HTTP Server 验证连接挂起、正文挂起、429、5xx、无 usage、取消及失败调用记录；不访问真实供应商，也不进入交易执行分支。

### 4. Python 子进程管理

为同 run ID 的 start 加锁；增加周期退出回收与有界完成记录，poll/wait 后移除 Popen 引用但保留终态判断依据。运行状态优先用 exit code；历史无进程记录的任务继续兼容原文件判断。加正常关闭的 stop/kill/wait 流程，并核验进程身份，防止 PID 复用误伤。保留 Checkpoint、报告及 Usage 文件。

此步只修复现有 `/api/start` 和 `/api/run` 的生命周期，不提前开发第二阶段的轻量状态/报告版本协议。

### 5. 降低监控扫描开销

低内存 admission 保留轻量 `/proc/meminfo` 读取。RSS 优先采样已知 externalPid，并校验 PID 起始时间；全量发现采用有时限缓存/低频重新发现，与日志输出频率分离。即使任务快速完成或反复恢复，也不允许每次循环都重扫全机。

重复使用本次全量扫描基线，在同一 mock 任务数下比较扫描次数、耗时、CPU、RSS和文件读取量。先验证稳定性，再决定缓存间隔，不依据空闲测试预先承诺吞吐提升。

## 第一阶段隔离验收与交付

- 创建唯一命名的临时数据库，初始化全部迁移，写入虚构用户、模型、任务和报告；以显式测试 URL 启动隔离 Worker/API，mock-only 配置确保不会落回真实模型。测试结束清理进程及临时库，不操作真实任务。
- 恢复并发：容量 1/2/4、待恢复任务数 0/1/8、有无存活 mock 子进程、两个 Worker 同时恢复、运行中降低上限；用生命周期事件记录峰值，而非只依赖轮询采样。
- Paper 领取：两个 Worker 对同一 run 竞争，正常情况下 Mock Provider 请求数为 1；覆盖 lease、owner fencing、不同崩溃位置和不确定提交策略。严格禁止进入真实交易/执行接口。
- 子进程：成功、非零退出、异常日志不含旧关键字、并发 start、挂起、关闭和重启；断言退出进程已 wait、registry 有界、无额外 mock 请求。
- 分段计时：小型 Mock LangGraph 与本地工具，覆盖正常/异常/重试/Checkpoint；校验 node/model/tool/write 归属和时长，检查不泄露 prompt/API Key，比较启用/关闭计时的 CPU/I/O。
- 双模型兼容：跨供应商、同供应商不同 API Key、同一配置两角色、使用量格式、历史调用、固定价格快照、恢复、积分路径；检查数据库落库身份与 API 选择规则不变。
- 保留现有 Checkpoint、usage/cost 测试与 Web/Worker 编译检查；修正 capacity 脚本的硬编码表数和缺少执行时长的夹具。
- 修复后再用同一只读 HTTP/DB fixture、样本数和资源采样复测。本次没有业务优化，修改前后收益栏目前应为“未实施/无数据”，不能把两次暖机差异称为优化收益。

第一阶段预期改动文件：`apps/workers/src/analysis-worker.ts`、`paper-trader-worker.ts`；`apps/api/stockdepth/api/server.py`、`analysis_runner.py`、新增性能回调模块；必要的 `apps/web/lib/db/schema.ts` 和新增迁移；对应 Mock/隔离测试与 `scripts/diagnostics/worker-capacity.cjs`。不改模型选择需求、供应商客户端凭据隔离方式和现有业务图顺序。

## 风险与回滚

- 当前基线未覆盖完整 AI 分析、公网延迟、浏览器长任务、并发容量或长期运行；这些不能作为已验收结论。Agent 内部耗时分解待第一阶段埋点。
- 新增 lease 必须处理旧任务、clock/TTL、owner 失效和请求已发送的不确定性，验收失败时不能靠自动重试收费模型掩盖问题。
- 新的性能事件需要容量上限和可关闭开关，防止监控本身增加磁盘或内存负担。
- 实施时保存独立的第一阶段差异和初始文件指纹，禁止 `git reset --hard`/整体 checkout 清除现有双模型工作。
- 本次回滚仅需删除新增诊断脚本与本报告，业务文件/数据库没有变更。未来修复回滚按第一阶段的专属差异回退；数据库新增调度字段先保留，等待受影响领取安全结束再禁用新 Worker，避免删除正在使用的 owner/lease。任何迁移或运行服务变更均需另行明确授权，不自动部署。

## 复测命令和原始证据

```bash
# 使用项目原有运行时，不安装或升级依赖。
STOCKDEPTH_DIAGNOSTIC_SAMPLES=10 /home/ubuntu/miniforge3/envs/stockdepth/bin/node scripts/diagnostics/latency.cjs
/home/ubuntu/miniforge3/envs/stockdepth/bin/node scripts/diagnostics/database-stats.cjs
STOCKDEPTH_DIAGNOSTIC_JOB_ID=99 /home/ubuntu/miniforge3/envs/stockdepth/bin/node scripts/diagnostics/stage1-baseline.cjs
```

新增脚本默认每接口 30 次、两轮，资源采样不少于 20 秒，仅顺序 GET 与只读 SQL。`STOCKDEPTH_BASELINE_SAMPLES` 可设 20–100；复测应固定报告 fixture、代码版本、样本数及服务负载。

原始证据：`var/performance/stage1-baseline-2026-10-13/baseline.json`、`resource-samples.json`、`existing-latency.jsonl`、`existing-database-stats.jsonl`、`historical-call-timings.json`、`source-manifest.json`。这些文件不含会话、凭据或报告内容。原始 JSON 保存完整精度，文档表格进行了四舍五入。

本轮检查：基线脚本 Node 语法检查通过；两轮所有 HTTP 样本成功，数据库只读测量成功；`git diff --check` 通过；初始业务差异指纹保持一致。没有宣称本轮新增的隔离恢复/原子领取测试已执行，相关测试属于上述待确认的第一阶段修复。
