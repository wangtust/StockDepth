# StockDepth 多智能体执行升级

参考 [TradingAgents graph/setup.py](https://github.com/TauricResearch/TradingAgents/blob/1394a3f72aa4393e1a98f51b382434c4b4c2d972/tradingagents/graph/setup.py)，在 StockDepth 原有 SaaS 调度和持久化链路中实现独立分析师子图、工具轮次预算及汇合屏障，没有替换 Worker 或数据库用量统计。

## 行为与配置

新 Runner 任务使用 workflow v2。Market、Sentiment、News、Fundamentals 各自运行在独立 LangGraph 子图中，只向父图提交自己的报告；消息、工具结果和辩论状态不在分析师之间共享。按 1/2/4 个分支分批执行，各批汇合后继续下一批。Memory Log 是独立节点，与分析师同时启动；报告验证和记忆节点都完成后才开始 Bull/Bear → Research Manager → Trader → 风险团队 → Portfolio Manager → 评级验证。

- `STOCKDEPTH_ANALYST_CONCURRENCY=1|2|4`：Worker 的新任务请求值，默认 1。内部 `/api/start` 也接受整数 `analyst_concurrency`，Runner 可传 `--analyst-concurrency`。
- Quick 模型快照 `modelOptions.request_concurrency` 是容量上限，缺失时为 1。实际并发向下选择 1/2/4。例如请求 4、容量 3 时使用 2。开启 4 并发需要请求值和 Quick 容量都至少为 4。已有模型配置的高级 JSON 参数可传 `request_concurrency`。
- `STOCKDEPTH_MAX_TOOL_ROUNDS=5`：每位分析师最多执行 5 轮工具请求，可设 1–20；内部 API 参数为 `max_tool_rounds`，Runner 参数为 `--max-tool-rounds`。预算耗尽后允许一次最终报告回答；如果模型仍要求调用工具，立即结束并标记 `[MISSING RESEARCH REPORT]`。一次回答可包含多个工具，预算按轮计算。
- 缺失的所选报告会出现在报告正文和 `research_status` 中；未选择的分析师不计为缺失。缺失报告、无评级、条件式评级或冲突评级都产生 `REVIEW`，不会默认为 Hold。原始 PM 判断保留供复核；SaaS 交易信号解析将 REVIEW 视为未识别，不会生成买卖指令。

Quick/Deep 的独立供应商、密钥、模型参数、价格快照继续沿用原链路。默认模型超时 600 秒，可通过模型参数 `timeout` 设置大于 0 且不超过 3600 秒；`max_retries` 限制为 0–5，缺省遵循 `STOCKDEPTH_MODEL_MAX_RETRIES`（默认 2）。SDK 负责瞬时重试和退避，不在失败后自动串行重放整个分析，以免重复计费。

## 恢复与隔离

首次模型调用前在运行目录原子保存 `execution.json`，固定版本、分析师列表、实际并发、工具预算及分析身份。任务更换模型恢复时仍保留图形状，新模型的请求容量门控单独生效。发现没有执行清单的旧 Checkpoint 时保留 v1 串行节点名称与边，不丢弃旧状态。默认直接构造 `GraphSetup`/`StockDepthGraph` 仍兼容 v1；需要新图的程序调用可显式设 `workflow_version=2`。

Worker 通过数据库任务的 `userId` 传递 `memory_owner`，按用户哈希目录存放记忆；没有用户身份的 SaaS run 禁用全局 CLI 记忆。既有全局记忆不会自动迁移给任何用户。读写使用线程锁和文件锁，结果更新保持原子替换。SaaS 全量状态日志也写入当前 run 目录。记忆新增 `resolved_on` 元数据，只允许读取分析日期之前的决策及截至该日已经获知的结果；无法证明获知日期的旧记录不会注入历史分析。历史任务不使用今天的行情结算旧经验。

v2 工具执行前验证精确 ticker、日期格式、起止区间及历史截止日。错误请求返回可纠正的 ToolMessage，也消耗轮次预算。历史任务禁用不能证明发布时间的当前基本面、重述财务报表、内幕交易和实时社交源，并明确标为不可用；历史命名不采用今天的公司资料。Yahoo OHLCV 还会在返回后按请求日期再次裁剪。这是保守的数据可用性策略，尚未增加 SEC 等公告时点财务历史源，历史报告可能因此包含更多缺失数据说明。

## 并发边界与持久化

`analysis_jobs` 的 Worker 任务接纳、管理员并发、用户并发、租约及归属检查保持原实现。模型请求另加同主机跨 Runner 的文件锁容量门控，按 provider/endpoint/model-config ID 隔离；Quick/Deep 使用同一模型配置时共享容量。不同版本快照并存时遵守活跃调用中的较小容量。队列等待有超时，正常结束、调用失败或进程退出都释放容量；原 RPM 限流仍生效。容量门控覆盖同步分析 Runner，包括工具绑定与结构化输出，不是跨主机分布式信号量；多主机部署需统一容量服务或共享运行环境。更换为不同配置 ID 会使用不同容量桶。

子图流事件写入原 `progress.md`，只将父图状态用于完整报告，保留前端实时进度及原报告版本轮询。`analysis_model_calls` 仍通过 UsageRecorder 和 Worker 保存原调用 ID、Token、缓存用量、价格快照、费用及失败状态，未改动表结构。

新增 `execution_metrics.json` 和 `execution_summary.md`，统计各次尝试及累计耗时、模型调用数、失败比例、已知 Token/费用和完整性标志。耗时包含 Runner 尝试，不包含 Worker 排队时间。未知费用不按零费用解释。执行摘要通过原报告发现和 Worker 同步链路进入 PostgreSQL `analysis_reports`，可随报告查看；不向公开报告输出密钥或模型配置快照。

## 验证与基准

运行环境使用锁定的 Python 依赖和离线网络防护，真实 SDK 测试只连接本地 Mock HTTP，不请求付费模型或真实行情。

```bash
PYTHONPATH=apps/api STOCKDEPTH_TEST_OFFLINE=1 python -m pytest -q apps/api/tests -m 'not integration'
PYTHONPATH=apps/api python scripts/diagnostics/analyst-upgrade-benchmark.py --output /tmp/analyst-benchmark.json
pnpm check:workers
pnpm check:web
```

[基准原始数据](analyst-upgrade-benchmark-2026-10-15.json)：每种并发 5 次，每次模型调用固定延迟 50ms，使用生产 GraphSetup 和本地测试模型；下游辩论节点在此基准中是确定性 fixture，因此这些倍数只反映该测试负载。

| 并发 | 中位耗时 | 相对速度 | 模型调用 | 合成 Token | 合成费用 CNY | 正常试验失败率 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.433s | 1.00x | 8 | 120 | 0.000200 | 0/5 |
| 2 | 0.228s | 1.90x | 8 | 120 | 0.000200 | 0/5 |
| 4 | 0.123s | 3.51x | 8 | 120 | 0.000200 | 0/5 |

所有报告内容哈希一致；三种并发各有一次额外故障注入和 SQLite 恢复检查，确认完成的兄弟分支和已执行的新闻工具请求不重复执行。真实供应商性能、费用及限流失败率应在启用后用执行摘要和 `analysis_model_calls` 比较，不能从合成 Token/价格推断实际成本节约。

额外验收覆盖：新 Runner 失败后以同一 run ID 恢复、更换模型容量后拓扑固定、子图进度保留、用户记忆隔离、未来数据/错误 ticker 拒绝、跨进程退出释放请求锁、真实 SDK Quick/Deep 容量共享及价格快照记账。既有 PostgreSQL 隔离数据库测试覆盖 Worker 接纳/租约、完整/失败/部分报告同步、用量完整性、费用精度及跨供应商入队快照；不修改项目业务数据库。

最终在最新远端 dev 基线上验证：Python 340 passed、83 subtests passed、1 个需外部服务的 integration 用例未运行；Worker/Web TypeScript 检查通过；Worker 接纳、报告/用量同步及实际入队快照三个隔离数据库套件通过。没有调用付费模型；本地真实 SDK 测试连接的是 Mock HTTP。
