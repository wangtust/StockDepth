# 阶段三：图执行独立验收

日期：2026-10-13 UTC（北京时间 2026-10-14），分支 dev，验收基于 5d02c5c。结论：实验并行实现及隔离回归通过，默认仍串行；无真实模型收益证据，不启用并行。协调者没有提交、推送、部署、重启服务或进入阶段四。发布由调度器执行，origin/dev SHA 核验通过才放行；推送失败必须停止。

## 问题、设计及审查

覆盖前配置并发1/2实际请求峰值均为1。Python 在 setup.GraphSetup.setup_graph 中保留原串行节点名称和边，仅显式2调用 parallel_analysts.add_parallel_analysts；isolated_analyst 深拷贝状态，各自保留工具循环与 Checkpoint namespace，只合并唯一报告字段，按两分支一批经 barrier 进入后续研究/交易/风险流程。消息、sender、debate 不跨分支合并。analyst_execution.build_analyst_execution_plan 拒绝重复及无效并发；effective_analyst_concurrency 钳制 Quick 快照容量，缺容量回到1；trading_graph.StockDepthGraph 使用有效容量。default_config、API runner 和 Worker 未开放并发选项，生产路径仍1。

Worker analysis-ownership.claimAnalysis 原仅看候选快/深容量：活动共享 Deep 容量1，候选容量4仍被领取（实现者 baseline.log）；修复在原咨询锁事务内取同供应商/规范端点活动快深快照最小容量。独立复验拒绝第二任务；八个竞争领取者不重复，尾斜杠、同快深端点只计一次、独立端点、外部runner监控、过期租约和旧所有者 fencing 均通过。更保守准入解决容量正确性，不声称 SQL 加速。

契约 stage3-contract.json 保持 stage2 轻量状态 API 和版本轮询，无接口变更；并行报告在 superstep barrier 后可见，用量独立同步。Worker 限制的是任务数；ProviderRateLimiter 是 provider/endpoint/config ID 的本机 RPM 预约，非在途 semaphore。独立合成测试2任务×2分支峰值4，不能声称全局 request_concurrency=2。仅实验单图保证1/2；真实开启2前必须协调跨任务请求预算及 SDK 线程安全。本阶段验收的是默认串行及受控实验能力，不批准启用2。

## 独立验证与性能

完整命令和退出码保存在 var/codex-performance-team/stage3-coordinator-logs/checks.json、benchmark-commands.json；每项对应同目录日志。不是仅转述实现者日志：协调者重新执行全部检查。

- Python 非 integration 回归：293 passed、1 deselected、83 subtests passed、8既有 warnings；包含凭据、双模型、费用、计时、报告及旧串行 Checkpoint 兼容。
- 本机 Mock 图消息/工具隔离、子集与顺序、批次上限、实际 market/news prompt、本机调用 role/config/provider、Decimal 价格重开快照、日志不含消息内容通过。
- recovery.json：每种模式由两个不同PID运行失败/恢复；完成 Market 恢复调用0，News仅调用1（不重发工具请求），后两分析师各2。usage共9条：8成功合计120 Mock tokens，1 failed 保留未知用量/费用，最终报告一致。未证明 SIGKILL/断电或真实远端 exactly-once。
- 隔离 PostgreSQL：准入、旧15组 Worker 稳定性、报告增量同步、权限/双模型实际入队路由和积分账本通过；仅新建测试库应用历史迁移后删除，测试子进程清除继承凭据并使用独立 Keyring。无项目库 Worker、真实供应商、交易或真实账户变更。
- Worker/Web类型检查、9项版本轮询通过；实现者两份回滚补丁 reverse --check 通过。

协调者独立重放覆盖前 setup 及当前代码，各5轮；25ms固定等待 Mock，含usage写盘与tracemalloc，建图不计入。基准与回归同时运行存在主机调度噪声，不声称精确生产收益。

| 中位数 | 覆盖前1 | 覆盖前2 | 当前1 | 当前2 |
| --- | ---: | ---: | ---: | ---: |
| wall ms | 275.072 | 274.361 | 278.752 | 174.628 |
| CPU ms | 72.386 | 72.871 | 61.037 | 73.957 |
| Python分配峰值 bytes | 116058 | 116394 | 116126 | 251870 |
| RSS累计高水位 KiB | 143548 | 143316 | 143212 | 144244 |
| 请求峰值 | 1 | 1 | 1 | 2 |
| 调用 / Mock tokens | 8 / 120 | 8 / 120 | 8 / 120 | 8 / 120 |

20轮报告/最终决策SHA256均为 a47c040530d0740bc83cabe151a608d7c6bf29dce35f6d7bd2f8b273f19455b0。当前2相对1 wall约下降37.4%，CPU增加21.2%，Python分配峰值约2.17倍，RSS高水位多1032KiB。RSS是进程累计高水位；tracemalloc不含全部native内存。Mock tokens与费用计算不是真实模型账单；真实非确定性模型不保证正文/Token相同。实现者原始基线 wall 245.196/247.726 → 247.302/158.330ms，与本次复验方向一致，不能用两轮不同负载数据推断性能趋势。

## 保留、提交范围、限制与回滚

阶段二已由调度器提交并验证 origin/dev（stage2-push.json，5d02c5c），现有双模型和第一阶段依赖已在该提交内，本次没有需补交的前置未提交源文件或迁移。完整Python、旧Worker稳定性、实际双模型入队、隔离完整迁移及类型检查重新覆盖相关依赖。commit-review.json 逐文件记录本次所有拟提交路径、SHA256及审查理由；包括未改动的 push-verified-dev.py（审查显式清单/dev/普通推送/远端SHA门禁）。未修改任何他人脚本、依赖或迁移，不纳入.env、凭据、运行日志、var、node_modules。协调覆盖前副本及哈希在 stage3-coordinator-before/；Python/Worker原阶段覆盖前副本仍保留。

尚无真实供应商线程安全、共享在途限流、SDK内部重试独立计费、真实长报告、全历史SDK版本和长期运行证据；默认串行不需要依赖这些未验证能力。并行必须用同分析师选择/顺序/模式恢复；不得异常后自动串行重放，避免未知收费重复。缓存并发miss、全局config和新增SQL大规模成本仍有限制。研究/交易/风险业务节点未改，业务权限/积分/费用路径回归通过；并行拓扑不支持旧未完成任务切换模式。

保留此前成果的回滚：先审查后反向应用 stage3-python-logs/stage3-python.patch、var/performance/stage3-worker/stage3-worker.patch 和 stage3-coordinator-logs/stage3-coordinator.patch；三份只包含各角色阶段三改动，reverse --check已独立通过。无需数据库回滚；不得reset或checkout覆盖。并行未完成Checkpoint需同拓扑恢复，串行回退只用于新任务开始前。后续编辑冲突须手工合并。完整命令见阶段三 coordinator handoff，补丁和原始日志不提交。
