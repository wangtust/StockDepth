# 阶段四与最终独立验收

日期：2026-10-13 UTC（北京时间2026-10-14）。分支dev，起点c37f37f；阶段二5d02c5c、阶段三c37f37f已有调度器远端SHA验证记录。阶段四验收范围是开发代码、本机Mock、隔离数据库与有界持续测试，不是生产发布或真实模型容量认证。协调者未提交、推送、部署或重启应用。

## 问题、设计与审查

Python覆盖前故障测试证明RunnerRegistry._finish在写退出标记前删除active，磁盘异常后不能重试。改为原子replace成功后释放active；reap/shutdown继续回收其他孩子，最后传播OSError。永久磁盘故障仍不能保存退出状态；不自动重发未知费用请求，不承诺断电持久性。

Web原关闭details仍解析和挂载长正文，父更新重复解析；MarkdownRenderer与AnalysisProgress加memo，新DeferredDetails打开才挂载、关闭卸载。管理员article原key含完整正文，刷新导致重建，改为jobId/report.id。用户与管理员SWR请求错误或报告键不匹配时隐藏正文，用户详情错误同时隐藏usage/calls；成功刷新恢复。服务器权限、费用、任务动作及两模型选择未改变。瞬时500也会暂时隐藏正文；浏览器查找/复制关闭内容需先展开。

文件/函数：processes.py的_finish/reap/shutdown；markdown-renderer.tsx的MarkdownRenderer；analysis-progress.tsx的AnalysisProgress；deferred-details.tsx的DeferredDetails；analysis-client.tsx的AnalysisClient；admin-report-viewer.tsx的AdminReportViewer。新增test_stage4_python.py与两份stage4-python、六份worker-stage4诊断文件，协调新增coordinator-stage4-verify.py。逐文件审查、SHA256与验证映射见stage4-coordinator-logs/commit-review.json。

协调开始先保存PLAN、历史报告副本/哈希、Git状态及实现者性能表至stage4-coordinator-before。独立核验Python114与Worker/Web217个备份哈希；仅1个既有Python、4个既有Web文件变化。未覆盖旧双模型或阶段一至三代码；全部Worker源码保持。stage4-contract.json沿用轻量状态契约，usage每轮同步，正文按不透明版本读取；默认图并发1，实验2仍未获真实启用批准。

## 各阶段可复现前后对照

| 阶段/同条件场景 | 前 | 后 | 范围和结论 |
| --- | --- | --- | --- |
| 一：8恢复任务、配置并发2、三轮峰值 | 8/8/8 | 2/2/2 | 隔离Mock，修复准入；跨度358→1271ms为正确排队成本 |
| 一：10资源快照三轮中位数 | 210.755ms、10次全扫描 | 21.829ms、1次全扫描 | 原始resource-benchmark证据，不能外推线上CPU |
| 二：100重复事件、每轮replace/写字节/dumps | 500/90025800/200 | 5/900258/2 | 原副本重放，正文变化仍写，跨秒恢复补验通过 |
| 二：20轮两份100KB报告 | 20正文、4005956字节 | 2正文+20状态、407192字节 | 请求总数20→22；usage独立变化保留 |
| 三：串行1/实验2，中位wall | 275.072/274.361ms | 278.752/174.628ms | 固定25ms本机Mock；实验2的CPU及分配成本增加，默认仍1 |
| 四：长Markdown父更新中位数（实现者） | 8.2ms | 0.1ms | 162390字符、三轮30次，仅重复解析收益 |
| 四：关闭进度父更新/DOM（实现者） | 13.5ms/12058节点 | 低于分辨率/56节点 | 打开仍完整渲染，关闭卸载 |
| 四：API60秒p50/p95（实现者） | 1.441/3.431ms | 1.696/4.768ms | 恢复可靠性修复，无加速证据；任务352→347 |

前测重放覆盖前副本，不覆盖当前源码。阶段一现有旧服务空闲基线与阶段四隔离路由HTTP不是同栈，禁止作收益比。首次Markdown挂载实现者71→97ms长任务、挂载中位16→37.7ms，未解决初次长任务。协调再次重放before/after：Markdown父更新8.90→0.10ms，关闭进度16.75→0.05ms；关闭DOM12058→56，进度挂载32→2.10ms。Markdown首挂载中位23.5→66.5ms，长任务100ms→122/67ms，明确不支持首挂载加速。完整原样本与对照在browser-comparison.json；时间分辨率、主机竞争、小样本与合成夹具限制均保留。Mock调用/Token不能作为真实模型收益、费用或账单。

复现入口：一为stage1-recovery.cjs与apps/workers/tests/resource-benchmark.ts；二为stage2-python-benchmark.py、stage2-python-data-benchmark.py和Worker版本轮询测试；三为stage3-python-benchmark.py；四为worker-stage4-browser.cjs before/after及stage4-python-isolation.py --before/当前。完整历史命令分别见前三阶段报告与handoff；原备份及原日志存在性已核验，见evidence-audit.json。

## 最终独立验证

协调独立运行命令（项目根），已有Python/Node环境，不安装或升级依赖：

```bash
python3 scripts/diagnostics/coordinator-stage4-verify.py > var/codex-performance-team/stage4-coordinator-logs/verify.log 2>&1
# 首次执行的补充独立重放命令及argv记录：browser-before-command.json。
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage4-python-graph-soak.py --seconds 15 --output var/codex-performance-team/stage4-coordinator-logs/graph-soak.json > var/codex-performance-team/stage4-coordinator-logs/graph-soak.log 2>&1
(cd apps/web && node_modules/.bin/drizzle-kit check) > var/codex-performance-team/stage4-coordinator-logs/migrations-corrected.log 2>&1
git apply --reverse --check var/codex-performance-team/stage4-python-logs/stage4-python.patch
git apply --reverse --check var/performance/stage4-worker/stage4-worker.patch
git apply --reverse --check var/codex-performance-team/stage4-coordinator-logs/stage4-coordinator.patch
git diff --check
```

验证器每个子命令及退出码记录verification.json，stdout/stderr为各name.log；数据库套件顺序执行，日志路径隔离至协调目录，没有覆盖实现者原结果。修正后入口同时包含before重放及图soak，可完整复现。首次迁移检查从根目录读取了空目录，生成空journal，不能作真实迁移验收；已仅清理该生成文件，正确cwd重新检查通过。一次node -e before参数偏移实际跑了after，未当作before，修正argv后重跑；初次汇总因此缺文件失败，未冒充通过。

Python297 passed、1 deselected、83 subtests passed、9 warnings；排除真实integration，覆盖退出标记write/replace故障、回收公平性、本机SDK timeout、凭据/身份/Decimal、Checkpoint及业务节点。Web/Workers类型通过。真实迁移链check通过；完整迁移仅在随机隔离库重验，不操作项目库。

浏览器18项通过：完整展开/关闭卸载、父更新/全屏保持节点、报告和任务切换、版本更新、旧响应竞争、running轮询、hidden暂停、focus刷新、terminal停止、403隐藏与成功恢复、卸载停止请求。实际React生产bundle/实际组件；next/dynamic为lazy夹具，不含完整Next/CSS/hydration/session，不验证切换登录主体或真实后台标签行为。

480次只读GET，6组80请求、并发1/4，错误0；实际Web路由与隔离SQL、认证用户为夹具，跨用户报告404、DTO无测试凭据、行数/积分/账本前后不变。旧Worker15组稳定性、Paper超时/unknown费用不重发、两进程一次请求、旧owner隔离、准入、增量同步、双模型实际入队权限与余额回归通过；9项轮询契约、实际Handler+RunPoller联测通过，保留Token/role/config/provider及Decimal快照，旧接口fallback和版本竞态通过。

有界运行：两个真实隔离Worker仅内置Mock，60秒、75秒上限、进程树RSS512MiB上限；首轮独立SIGKILL可能选中空闲进程（40次Mock开始），不作为在途恢复证明；补跑明确选择持有任务的Worker。SIGKILL后替代进程恢复，40任务完成、峰值2、41次开始（一次Mock恢复重做），实际60129ms、进程树RSS峰值381112KiB（372.18MiB），积分100/账本0。API60秒、RSS256MiB/FD80/线程24限制，独立API进程优雅重启、挂起孩子kill/wait、失败退出标记与报告版本恢复；独立复跑357任务，p50/p95为1.378/2.165ms，单轮主机噪声不作加速收益。每请求3秒、总100秒上限。图串行/实验2各15秒、RSS300MiB/FD80限制，临时SQLite、实际LangGraph与usage，决策哈希一致。Checkpoint显式恢复由不同PID验证，已完成调用不重发，失败用量/费用unknown保留。各资源曲线和事件包含在soak.json、api-isolation/result.json、graph-soak.json及graph-recovery.json；不清洗RSS或Checkpoint增长。

## 限制、提交门禁与回滚

60秒与15秒不能证明小时级无泄漏；图SQLite/usage按新thread_id增长，实验2在同进程顺序执行继承先前分配，不能比较净RSS。未验证真实模型、远端线程安全/SDK内部重试账单、真实行情、交易、生产session与部署栈、硬崩溃API孤儿接管/断电exactly-once。缓存TTL、元数据版本、跨报告/usage非事务快照、无fsync限制沿用。默认串行、明确恢复拓扑及未知费用不重发保留；不批准真实并行2或生产容量结论。

本阶段无新迁移；双模型与阶段一源文件、迁移和测试已包含于5d02c5c，阶段三于c37f37f；没有遗漏的未提交前置依赖。本次完整Python/隔离Worker/入队/类型/浏览器补验覆盖当前依赖。commit_paths明确列本阶段修改及未改动但复审的push-verified-dev.py；不重复提交已在HEAD的前置文件。清单与工作区逐项比对，无.env、凭据、var、日志、node_modules或构建缓存。推送脚本检查dev、无既有暂存、显式路径、远端祖先、普通push与远端SHA；协调不亲自commit/push。complete仅表示验收通过与允许调度器发布；调度器推送失败必须blocked，不绕过，无下一阶段。

三份角色增量补丁均reverse --check通过，基于各自覆盖前副本，只撤销阶段四并保留双模型及一至三阶段。先核验，决定回滚后按协调/Worker/Python反向应用；后续编辑冲突人工合并，不reset/checkout覆盖、不回退数据库或删除费用历史。原补丁和运行日志在var，不纳入提交。
