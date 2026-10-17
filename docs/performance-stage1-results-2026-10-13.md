# 第一阶段：性能基线与 Worker 稳定性验收

日期：2026-10-13。分支：dev。仅完成第一阶段；第二、三、四阶段未开始。没有部署、重启现有服务或合并 main。项目数据库迁移记录仍为 33 条（截至 0032），新增迁移只在隔离库验证；隔离库已删除。

## 修改前的问题与证据

详见 [审查与基线](performance-stage1-review-2026-10-13.md)。恢复路径会一次启动全部 running 任务；Paper Worker 在请求模型前没有原子领取；Python API 子进程缺少统一回收；资源监控每轮扫描 /proc；缺少 Agent、工具、模型及报告写入耗时。Paper 请求已有 60 秒超时，本次保留默认值并完善测试与配置，没有重复实现。

基线第二轮（每接口 30 次顺序只读请求）：

| 项目 | p50 ms | p95 ms |
| --- | ---: | ---: |
| Web 页面 | 22.073 | 29.737 |
| 任务列表 | 4.922 | 6.069 |
| 任务详情 | 5.093 | 7.158 |
| 报告 | 6.400 | 14.148 |
| Python options | 1.155 | 1.850 |
| 数据库 RTT | 0.071 | 0.164 |

服务当时没有活动分析任务。这是空闲顺序请求基线，不代表生产容量。现有服务仍运行旧代码，因此没有把其 HTTP 指标声称为修复后的性能。

## 文件与设计

| 文件 | 函数或组件、修改原因 |
| --- | --- |
| apps/workers/src/analysis-ownership.ts | claimAnalysis、assertAnalysisOwner、renewAnalysis：数据库租约及所有权校验，事务内串行准入；同时检查全局、用户及两模型供应商容量 |
| apps/workers/src/analysis-worker.ts | 恢复与主调度共用容量控制；租约心跳及写入隔离；存活外部任务只监控；同步用量保留 role/config ID/provider |
| apps/workers/src/paper-ownership.ts | claimPaperRun 原子领取；请求已提交后中断标记 unknown，并生成可见失败结果，不自动重复收费 |
| apps/workers/src/paper-trader-worker.ts | processRun、callDecisionModel：请求前持久化调用身份和价格快照；明确超时、心跳、脱敏及原子完成 |
| apps/workers/src/resources.ts | ResourceMonitor：全量发现默认间隔 30 秒；每次仍读取新内存数据；新 runner 可单独登记，校验 PID 身份 |
| apps/api/stockdepth/api/processes.py | RunnerRegistry：锁保护同任务启动、回收与等待退出、有限历史缓存及持久化退出状态、关闭时清理 |
| apps/api/stockdepth/api/server.py | 接入 registry、后台回收及关闭处理；非零退出不能因旧报告而误判成功 |
| apps/api/stockdepth/api/timing.py | TimingRecorder：Agent、工具、模型、报告写入计时；有界队列及日志轮转，避免记录请求内容和密钥 |
| apps/api/stockdepth/api/analysis_runner.py | 为 graph 与直接模型调用接入计时；保留报告原子写入与现有 Checkpoint 流程 |
| apps/api/stockdepth/api/usage.py | 相同 call ID 去重，防止模型与 graph callback 重复计数 |
| apps/web/lib/analysis/runner-process.ts | isAnalysisRunner：取消任务前核验 PID、脚本与 run ID |
| apps/web/lib/analysis/public-job.ts | publicAnalysisJob：浏览器返回值移除密钥配置快照及 Worker 所有权字段 |
| apps/web/app/admin/actions.ts；app/api/analysis/jobs/[id]/retry/route.ts | 重试和取消撤销旧租约，防止旧 Worker 回写 |
| apps/web/app/api/analysis/jobs/route.ts；app/api/paper/analyze/route.ts | 返回上述公开 DTO；保留选择、权限及积分逻辑 |
| apps/web/lib/db/schema.ts；migrations/0033_worker_ownership.sql、0034_worker_lease_indexes.sql 及对应 meta | 新增租约、Paper 提交状态、调用结束时间及调度索引；追加迁移，不改历史迁移 |
| apps/api/tests/test_execution_timing.py、test_runner_registry.py | 计时去重、隐私、边界、并发启动、回收及退出恢复测试 |
| apps/api/tests/test_memory_log.py、test_structured_agents.py | 修正旧 Mock 的 invoke(config=...) 接口，业务断言不变 |
| apps/workers/tests/stage1-stability.ts、resource-benchmark.ts | 隔离数据库/Mock HTTP 稳定性测试及资源扫描对照 |
| scripts/diagnostics/stage1-worker-tests.cjs、stage1-recovery.cjs、stage1-timing.py、worker-capacity.cjs | 隔离测试、恢复并发与计时开销对照；容量脚本适配现有迁移 |

默认租约 90 秒；所有权校验保护报告、用量及完成写入。未提交的 Paper 任务可重新领取；已经提交的请求发生中断，其远端结果可能未知，自动重发会重复计费，因此转为终态失败并保留未知费用。SDK 内部 HTTP 重试不是独立 callback，目前不能逐次识别其供应商账单。

## 测试结果与对照

- Python 非真实供应商回归：264 passed、1 deselected、80 subtests passed、8 warnings。排除真实 DeepSeek 集成测试。
- 隔离 Worker：15 组通过，包括跨供应商凭据隔离、同供应商不同账户、未知价格/usage、超时和错误脱敏、双进程 Paper 竞争一次请求、旧所有者隔离及历史价格快照。
- Web/Workers TypeScript 检查、Drizzle 迁移检查、diff 格式检查通过。
- 隔离 Mock 容量 1/2/4：各 8 个任务全部完成，峰值分别 1/2/4；无真实模型调用、交易或积分扣减。

| 可重复测试 | 修改前 | 修改后 | 解读 |
| --- | --- | --- | --- |
| 8 个恢复任务、配置并发 2，三轮峰值 | 8 / 8 / 8 | 2 / 2 / 2 | 修复超限 |
| 同上，执行跨度中位数 | 358 ms | 1271 ms | 正确排队需要更长时间，不作为加速收益 |
| 两个分析 Worker、8 个任务 | 未作同条件前测 | 峰值 2，跨度 1276 ms | 跨进程准入验证 |
| 杀死 Worker 后恢复、4 个任务、测试租约 3 秒 | 未作同条件前测 | 全部恢复，峰值 2 | 测试租约与生产默认不同 |
| 连续 10 次资源快照，三轮总耗时中位数 | 210.755 ms | 21.829 ms | 降低约 89.6%；全量扫描 10 次降至 1 次 |
| 30 次 Mock 图执行含 100KB 报告，计时关闭/开启中位数 | 147.130 ms | 149.808 ms | 新计时约增加 2.68 ms（1.82%）；CPU 增加约 3.07 ms |

恢复对照 RSS 中位数约 148.08 → 140.60 MiB；样本仅三轮且存在运行时噪声，不保证实际生产内存下降。计时测试双方均为 30 次 Mock 调用、360 tokens；无收费请求。尚无优化后真实完整分析、前端长任务或长时间运行数据，属于后续阶段。

复现入口：stage1-worker-tests.cjs、stage1-recovery.cjs、worker-capacity.cjs 需指定现有 STOCKDEPTH_RUNTIME_BIN；协调脚本只创建并删除本机隔离库。Python 回归必须继续排除真实供应商集成测试。原始日志与 JSON 位于 var/performance/stage1-implementation/；基线位于 var/performance/stage1-baseline-2026-10-13/。

## 兼容性、迁移及回滚

原有七个双模型新增文件的 SHA256 校验均未变化；未覆盖先前开发成果。Quick/Deep 身份、凭据隔离、费用快照仍保留；旧任务按现有兼容路径处理。Checkpoint、报告内容与业务流程没有重构。模型请求 timeout 默认仍为 60 秒。

0033 为新增字段及既有 Paper 决策状态回填；0034 增加索引。已在新建隔离库按完整历史迁移验证。应用这些迁移并运行新代码需要另行部署；当前没有操作项目数据库。生产部署前应评估索引创建和回填的锁等待，并协调旧 Worker 停止后再切换。跨 API 重启瞬间的外部请求不是事务性 exactly-once；租约到期恢复延迟、异常磁盘写入及长时间运行仍需后续观察。

第一阶段专用补丁：var/performance/stage1-implementation/stage1.patch；覆盖前副本：同目录 before/。补丁反向应用可保留此前未提交双模型修改，已执行 git apply --reverse --check 验证。若之后继续编辑，须先处理冲突，不能用 git reset --hard。当前未应用数据库迁移，代码回滚无须改数据库；未来若已应用迁移，可先回退代码并保留新增字段，不删除调用历史或直接改迁移日志。计时可通过 STOCKDEPTH_TIMING_ENABLED=false 关闭。
