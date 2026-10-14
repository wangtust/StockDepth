# StockDepth / InnoPilot 性能与稳定性执行计划

更新日期：2026-10-14（北京时间）。开发分支：`dev`，或从 `dev` 派生的独立分支。

## 执行约定

用户已授权阶段二、三、四依次推进。每阶段完成独立测试、更新交付文档和本计划后，自动继续下一阶段，不再逐阶段请求确认。此约定替代此前“后续阶段需确认”的限制。

开始和恢复工作时先读取本计划、相关阶段报告及 Git 状态；保留已有双模型修改，已经完成的优化不重复重构。按顺序执行，不同时启动多个阶段。失败时先修复并重新验证，不把失败的阶段标记为完成；确实需要外部信息时记录阻塞原因。

仅修改开发分支。不自动部署、重启运行服务、合并 main 或应用项目数据库迁移。2026-10-14 新授权：每阶段验收通过后，由协调者逐文件审查提交清单，调度器提交并推送 origin/dev，验证远端 SHA 后才进入下一阶段；禁止强制推送，失败停止推进。既有双模型与第一阶段依赖仅在审查和兼容验证后纳入，凭据与临时数据禁止提交。数据库测试仅使用隔离库，模型测试仅使用 Mock Provider；不调用收费模型，不执行真实交易，不修改真实账户、任务、积分或支付数据。不随意升级依赖或新增基础设施。

每阶段交付：修改前证据；文件和函数清单；设计原因；可重复的前后性能数据和回归结果；剩余风险与回滚方案。保留跨供应商调度、凭据隔离、用量与费用快照、旧任务和 Checkpoint 兼容性。

本文件是执行与恢复工作依据。已按用户授权在 tmux `codex` 会话接入三个角色的后台调度器：Python/图执行、Worker/前端、验收协调。调度脚本为 `var/codex-performance-team/team.py`，状态为同目录 `state.json`。阶段二、三、四依次推进，协调验收通过才放行下一阶段；失败、缺少交付证据或单角色阶段超过六小时则停止推进，不无限重试。

通过 `tmux attach -t codex` 查看新增 perf-python、perf-worker、perf-coordinator 窗口；详细事件、错误与交付保存在 `var/codex-performance-team/`。创建同目录 `STOP` 文件可停止团队，调度器会终止它启动的执行进程；不停止应用服务。调度器存活时聊天结束不影响执行，主机重启或 tmux 退出则需要手动恢复，不配置 cron 或开机启动。

## 状态

| 阶段 | 状态 | 交付 |
| --- | --- | --- |
| 一：性能基线与 Worker 稳定性 | 已完成代码与隔离验证，未部署 | [审查](docs/performance-stage1-review-2026-10-13.md)、[验收](docs/performance-stage1-results-2026-10-13.md) |
| 二：报告与数据层优化 | 独立验收完成；调度器已提交并验证 origin/dev 5d02c5c | [验收及历史阻塞证据](docs/performance-stage2-results-2026-10-13.md) |
| 三：LangGraph 执行效率 | 独立验收完成；调度器已提交并验证 origin/dev c37f37f | [验收](docs/performance-stage3-results-2026-10-13.md)；无真实收益证据，默认串行 |
| 四：前端与最终验收 | 独立最终验收通过；待调度器提交并验证 origin/dev | [最终验收](docs/performance-stage4-results-2026-10-13.md)，未部署 |

## 阶段二：报告与数据层

- [x] 审查现有报告签名、原子写入、Checkpoint 和缓存实现，建立隔离 Mock 基线。
- [x] analysis_runner.py 仅在报告内容变化时更新；序列化复用及跨秒 Generated 恢复已修复并独立复验，标题/正文变化仍写入。
- [x] Python API 提供轻量任务状态及报告版本；Worker 仅在版本变化时读取正文并增量同步。
- [x] 检查 Yahoo Finance 历史行情缓存与技术指标数据复用；正常数据哈希一致，日期截断修复未来回填，缺失行情旧输出可能修正。
- [x] 原子写入、Checkpoint 中断恢复、旧任务及前后对照已验证；完整报告跨秒恢复、标题/正文变化测试通过。
- [x] 阶段二验收文档及本计划已更新；Python 274 passed、隔离联合/Worker/双模型入队及类型/迁移检查通过。由调度器提交推送并验证远端 SHA 后放行阶段三；推送失败必须 blocked。

## 阶段三：LangGraph 执行效率

- [x] 根据已有计时与隔离测试识别瓶颈；无真实耗时数据时明确证据不足，不用 Mock 推断真实模型收益。
- [x] 为独立分析师设计并行执行；处理 State 合并、消息隔离及 Checkpoint 恢复，保留串行选项。
- [x] 使用 Mock Provider 对照并发 1/2 的耗时、Token、CPU、内存及结果一致性。
- [x] 只有证据支持收益大于资源成本时启用并行；否则保留串行默认并记录结论。
- [x] 完成阶段三验收和回滚说明，更新计划；调度器提交推送并验证 origin/dev 后才放行阶段四，协调者不自行进入。

## 阶段四：前端与最终验收

- [x] 使用可用浏览器性能工具定位长报告渲染长任务，减少不必要的重新渲染。
- [x] 验证报告切换和 SWR 缓存生命周期，保持权限与数据更新正确。
- [x] 运行只读 HTTP 压测及隔离 Worker 并发、超时、重启、恢复测试。
- [x] 执行有明确持续时间和资源上限的隔离运行测试，记录覆盖范围及未验证内容。
- [x] 提交可重复的前后对照、完整回归结果、兼容性检查与回滚方案。
- [x] 更新最终状态；停止于可审查开发成果，不部署、不合并 main；阶段验收通过后允许提交并推送 dev。

## 下一次执行入口

阶段四独立最终验收完成：Python297项/83子测试、Web/Worker类型、真实迁移链、18浏览器行为、480隔离只读GET、旧Worker稳定性/双模型入队/费用身份/轮询与Handler联合回归通过。两个隔离Worker60秒、在途任务SIGKILL恢复及API60秒优雅重启、图每模式15秒均在资源上限内；仅本机Mock和隔离库。默认图仍串行，不批准真实并行2；首次Markdown挂载长任务、小时级稳定性、硬崩溃API孤儿接管及真实模型未验证，详见最终报告。

双模型和第一阶段前置功能已包含在阶段二5d02c5c，阶段三c37f37f已由调度器验证远端；本次没有未提交前置依赖。阶段四receipt.commit_paths为逐文件审查清单，包含push-verified-dev.py，不含凭据或运行日志。协调者没有commit/push；调度器执行普通origin/dev推送并核验远端SHA，失败必须blocked，不能绕过。停止于阶段四，无下一阶段、部署或main操作。回滚只用覆盖前增量补丁，保留一至三阶段及双模型成果。


## 2026-10-14: Frontend UI/UX round

Previous performance round completed and published dev d413d95. Active work now follows [frontend UI plan](docs/frontend-ui-plan.md): frontend-only Phase0 audit plus phases1–4, three-role tmux team, independent acceptance and ordinary origin/dev push after each phase. No deployment or service restart. Preserve current uncommitted frontend changes and freeze admin/actions.ts. User-facing provider/incomplete diagnostics remain hidden per explicit earlier preference. State: var/codex-frontend-team/state.json.

### Frontend Phase1 coordinator checkpoint — 2026-10-14（北京时间）

Phase0审查及Phase1返修独立验收通过：英文Retry可读且内部字段隐藏；HEAD含独立发布7ae2378，actions.ts冻结并等于HEAD；发布工具允许必需frontend测试。四错误页面Mock桌面/移动、独立保存/其他未保存编辑、组件回归、Web tsc及冻结哈希通过，见 docs/frontend-ui-results.md。coordinator仅文档/自身测试，没有commit/push。当前等待调度器按receipt.commit_paths普通发布origin/dev并核验远端SHA；发布失败blocked，在此之前不进入Phase2。管理员移动溢出留Phase3。
