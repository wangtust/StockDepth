# 第二阶段：报告与数据层独立验收

更新日期：2026-10-14（北京时间）；分支 dev；结论 **阶段二独立验收通过，待调度器提交并验证 origin/dev 后放行**。Python 新 receipt 与修复哈希已核验，原跨秒失败已独立复验通过；当前未进入阶段三。协调者未提交/推送、部署、重启应用、应用项目库迁移、修改 .env/凭据或操作真实模型/交易/任务/账户/积分/支付。以下保留首次验收历史记录，当前结论与完整续接命令见末尾章节。

## 首次验收历史：阻塞问题与修复要求

`apps/api/stockdepth/api/report_persistence.py::ReportPersistence.save_complete` 比较 `previous.splitlines()[2:]` 与新报告相同切片，试图忽略 Generated 元数据。但 `analysis_runner.build_complete_report` 用双换行连接标题与 Generated，所以 Generated 实际位于索引 2，仍参与比较。新 persistence 实例跨秒恢复时，即使正文相同仍写新时间并原子替换文件，改变报告版本，触发 Worker 再读/同步。

确定性独立复现：首写时间 00:00:00，同实例在 00:01:00 不写；换为新实例后正文相同，Generated 变为 00:01:00，文件内容和 mtime 均变化，断言失败、退出 1。证据：`var/codex-performance-team/stage2-coordinator-logs/recovery-cross-second.log`。原测试立即恢复，未跨秒，不能证明交付声称的“恢复保留 Generated”。此问题不说明 Checkpoint 状态丢失，但违反仅内容变化更新及恢复时保留生成时间的交付要求。

由 Python 所有者修正仅排除指定 Generated 元数据的比较，保留标题/正文变化检测，加入确定性跨秒恢复测试，更新 handoff、补丁和哈希后再协调复验。协调角色不越权修改 apps/api，也未启动新智能体；问题已通过 `var/codex-performance-team/stage2-coordinator.checkpoint.json` 通知团队。首次验收当时不可放行下一阶段；此缺陷已在下方2026-10-14续接中修复并复验。

## 已审查设计与文件

| 文件/函数 | 设计与独立结论 |
| --- | --- |
| analysis_runner.py：write_text、save_report_parts、save_progress、save_state_json、main；report_persistence.py | 每 runner 缓存正文/状态/公开消息历史，嵌套状态深拷贝，Decimal 保留 default=str，唯一临时文件原子替换，缓存失败不前移。保留 Checkpoint 恢复及第一阶段计时；首次验收跨秒完整报告恢复有上述缺口；本次已修复 |
| server.py：read_report_files、report_version、Handler.do_GET | 同鉴权/路径校验，轻量端点无正文和绝对路径；版本按路径/mtime_ns/size摘要；旧接口保留正文/日志。usage 独立返回，失败日志有界；真实 Handler 与 poller 联测通过 |
| stockstats_utils.py：load_ohlcv、_file_signature | 32条有限缓存、深副本、CSV元数据失效、当前日60秒/历史300秒TTL，原子CSV写入；先截断再填充，防未来回填。已有批量指标计算保留 |
| y_finance.py：_historical_frame、get_YFin_data_online | 32条区间缓存、60秒时间桶、目录隔离、深副本，结束日包含逻辑保留；正常数据正文哈希对照一致 |
| analysis-polling.ts：RunPoller.poll/full/read、reportValues/reportMatches | 版本仅作相等比较，初次/变化时取正文，usage每轮更新；旧端点回退、竞态阻止终态完成，失败/JSON异常传播 |
| analysis-worker.ts：processJob、saveReports、progressSignature | 报告逐行增量同步，保留未变行ID/时间；事务内租约断言；报告版本与usage完整性进入进展签名，保留双模型费用/身份逻辑 |
| Python/Worker新增 tests、三个角色 stage2 诊断脚本 | 实现者脚本只读审查；协调只新增 coordinator-stage2-joint.py、coordinator-stage2-recovery.py |

完整实现文件列表、覆盖前证据、设计及测试见 `var/codex-performance-team/stage2-python.handoff.md` 与 `stage2-worker.handoff.md`。独立核验团队开始时57个未改文件SHA256全部相同，含双模型、第一阶段、Web、迁移与其他角色脚本；记录 `stage2-coordinator-logs/preserved-start-files.json`。实现者最终文件哈希亦核验，协调未编辑其源文件。

## 独立验证结果与完整命令

以下从项目根执行，日志目录均为 `var/codex-performance-team/stage2-coordinator-logs/`。使用已有环境，无依赖升级。

```bash
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python -m pytest apps/api/tests -m 'not integration' -q > var/codex-performance-team/stage2-coordinator-logs/python-regression.log 2>&1
STOCKDEPTH_RUNTIME_BIN=/home/ubuntu/StockDepth/apps/workers/node_modules/.bin node scripts/diagnostics/worker-stage2-tests.cjs > var/codex-performance-team/stage2-coordinator-logs/worker-db.log 2>&1
(cd apps/workers && node_modules/.bin/tsx tests/stage2-version-polling.ts) > var/codex-performance-team/stage2-coordinator-logs/worker-polling.log 2>&1
(cd apps/workers && node_modules/.bin/tsc --noEmit) > var/codex-performance-team/stage2-coordinator-logs/worker-typecheck.log 2>&1
(cd apps/web && node_modules/.bin/tsc --noEmit) > var/codex-performance-team/stage2-coordinator-logs/web-typecheck.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/coordinator-stage2-joint.py > var/codex-performance-team/stage2-coordinator-logs/joint.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/coordinator-stage2-recovery.py > var/codex-performance-team/stage2-coordinator-logs/recovery-cross-second.log 2>&1
STOCKDEPTH_RUNTIME_BIN=/home/ubuntu/StockDepth/var/codex-performance-team/stage2-coordinator-runtime node scripts/diagnostics/stage1-worker-tests.cjs > var/codex-performance-team/stage2-coordinator-logs/worker-stage1-regression-runtime.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage2-python-benchmark.py var/codex-performance-team/stage2-coordinator-logs/python-before-repeat.json --before > var/codex-performance-team/stage2-coordinator-logs/python-before-repeat.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage2-python-benchmark.py var/codex-performance-team/stage2-coordinator-logs/python-after.json > var/codex-performance-team/stage2-coordinator-logs/python-benchmark.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage2-python-data-benchmark.py var/codex-performance-team/stage2-coordinator-logs/data-before-repeat.json --before > var/codex-performance-team/stage2-coordinator-logs/data-before-repeat.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage2-python-data-benchmark.py var/codex-performance-team/stage2-coordinator-logs/data-after.json > var/codex-performance-team/stage2-coordinator-logs/data-benchmark.log 2>&1
git apply --reverse --check var/codex-performance-team/stage2-python-logs/stage2-python.patch > var/codex-performance-team/stage2-coordinator-logs/python-rollback-check.log 2>&1
git apply --reverse --check var/performance/stage2-worker/stage2-worker.patch > var/codex-performance-team/stage2-coordinator-logs/worker-rollback-check.log 2>&1
git diff --check > var/codex-performance-team/stage2-coordinator-logs/diff-check.log 2>&1
```

Python：272 passed、1 deselected、80 subtests passed、8 warnings，真实集成测试排除；覆盖原子失败/重试/完整文件读取、Checkpoint模拟中断恢复、旧报告、日期/TTL、副本隔离。Worker：9轮询项目通过，隔离数据库验证未变行无写、单行更新ID保留、增删/恢复、usage完整性、12 tokens和0.000026000000 Decimal费用、旧租约拒写、测试积分100不变；processJob只监控本机Mock，完成/失败/恢复待准入路径通过。两个TypeScript检查通过。

实际 Python Handler + 实际 RunPoller 联测通过：无变化、仅usage变化、身份/Decimal、等大小正文变化、新实例恢复、完成、正文版本未变时失败日志、轻量字段、鉴权/路径拒绝；10状态请求（含两个拒绝请求）、4正文请求，无数据库/模型请求。此联测未把实际Handler与实际数据库processJob串成一个进程链，二者分别验证。

首次跨秒恢复独立验收退出1，因此该次验收结论blocked。联测初次因协调脚本请求数误写11而失败，修正为10后通过，原日志保留 `joint-first-attempt.log`。追加阶段一回归初次runtime目录缺python而失败，原日志 `worker-stage1-regression.log` 保留；仅在团队目录提供指向已有tsx/python的链接后复跑，15组稳定性/凭据/超时/费用/资源断言通过、退出0；不升级依赖、不修改应用目录。

## 性能对照与限制

覆盖前基线在编辑协调文件前复制保存为 `python-before.json`、`python-data-before.json`、`worker-before.json`；协调也用原副本重跑前测。下表为独立复跑实测，不是部署后服务指标。

| 场景 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 100重复图事件，3轮每轮替换数 | 500 | 5 |
| 每轮写字节 / json.dumps | 90,025,800 / 200 | 900,258 / 2 |
| 同场景耗时中位数 | 324.85 ms | 15.75 ms |
| 100轮报告数组读取+编码 | 104.44 ms；每轮300,196字节 | 63.83 ms；每轮186字节 |
| 20历史OHLCV | CSV19次、Mock下载1次；123.19 ms | CSV0次、Mock下载1次；74.72 ms |
| 20当天OHLCV | Mock下载20次；123.88 ms | Mock下载1次；84.50 ms |
| 20历史区间格式化 | Mock请求20次；24.43 ms | Mock请求1次；148.50 ms |
| Worker 20轮两份100KB正文，单份等大小更新 | 20正文请求、4,005,956字节 | 2正文+20状态请求、407,192字节 |

正常OHLCV及区间正文哈希前后一致（区间忽略获取时间头）。字节减少约89.8%，正文请求少90%，总HTTP请求20→22增加10%；数据库变化从旧算法删除2/插入2到更新1，旧动作来自原代码/harness，新动作经隔离行断言验证，非SQL profiler数据。

协调性能复跑与类型检查并行，存在主机竞争，尤其区间格式化明显更慢；不得宣称每项墙钟加速。实现者较空闲测量为322.06→4.75 ms、区间14.30→16.40 ms，也没有区间格式化收益。可信结论为该Mock场景减少重复I/O/序列化/请求数量，不能外推真实模型、Yahoo实网、生产吞吐、Token或费用收益。无变化场景不能代表每事件正文变化；未测真实长任务或长期RSS。

缓存有限但新增内存，当前日最多60秒陈旧；不共享子进程、首个并发miss没有single-flight。文件元数据版本可能漏掉刻意保持mtime/size的外部修改，报告/usage非事务快照，竞态最多延后重试；完整接口stat/read跨原子替换仍为最终一致语义。原子替换不含fsync，未验证断电耐久性。先截断再回填会修正旧有未来数据泄漏，异常缺失行情的输出可不同。五年历史窗口保留。真实供应商计费/进程终止、浏览器及长期运行尚未验证。

## 回滚及续接

协调覆盖前副本/哈希：`var/codex-performance-team/stage2-coordinator-before/`；协调专用补丁：`stage2-coordinator-logs/stage2-coordinator.patch`，仅PLAN、本报告及两份协调脚本。实现补丁：`stage2-python-logs/stage2-python.patch`、`var/performance/stage2-worker/stage2-worker.patch`。均以覆盖前工作副本为基准，保留双模型与阶段一修改，不使用HEAD还原。

```bash
git apply --reverse --check var/codex-performance-team/stage2-coordinator-logs/stage2-coordinator.patch
git apply --reverse --check var/performance/stage2-worker/stage2-worker.patch
git apply --reverse --check var/codex-performance-team/stage2-python-logs/stage2-python.patch
```

三个检查通过后，若决定回滚，按协调、Worker、Python顺序使用对应 `git apply --reverse`；这里只验证，不实际回滚。后续编辑冲突必须按副本手工解决，不reset/checkout覆盖；本阶段无新增数据库迁移，不改项目库。首次blocked的续接入口为上述Python修复与跨秒测试；本次独立重跑通过后才更新结论，未以旧receipt代替复验。


## 2026-10-14 续接独立验收（当前结论）

Python 仅修复 report_persistence.py::_complete_content/save_complete 与新增两个确定性测试：固定报告头仅排除 Generated 元数据，其余字节保留。新实例跨60秒恢复正文/mtime/size/inode/公开版本不变且 replace=0；ticker标题、正文和正文内 Generated 变化仍各 replace=1。协调者未修改任何实现者文件；Worker 六文件最终哈希与原交付完全相同，Python 八文件与新交付完全相同。新覆盖前副本和 SHA256 在 stage2-coordinator-before/resume-2026-10-14/，原性能基线、首次 blocked 报告和失败日志均保留。

本次独立运行命令，从项目根执行；下列最终命令均退出0，日志均实际存在：

```bash
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python -m pytest apps/api/tests -m 'not integration' -q > var/codex-performance-team/stage2-coordinator-logs/resume-python-regression.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/coordinator-stage2-recovery.py > var/codex-performance-team/stage2-coordinator-logs/resume-recovery.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/coordinator-stage2-joint.py > var/codex-performance-team/stage2-coordinator-logs/resume-joint.log 2>&1
STOCKDEPTH_RUNTIME_BIN=/home/ubuntu/StockDepth/apps/workers/node_modules/.bin node scripts/diagnostics/worker-stage2-tests.cjs > var/codex-performance-team/stage2-coordinator-logs/resume-worker-db.log 2>&1
STOCKDEPTH_RUNTIME_BIN=/home/ubuntu/StockDepth/var/codex-performance-team/stage2-coordinator-runtime node scripts/diagnostics/stage1-worker-tests.cjs > var/codex-performance-team/stage2-coordinator-logs/resume-worker-stage1.log 2>&1
(cd apps/workers && node_modules/.bin/tsx tests/stage2-version-polling.ts) > var/codex-performance-team/stage2-coordinator-logs/resume-worker-polling-corrected.log 2>&1
(cd apps/workers && node_modules/.bin/tsc --noEmit) > var/codex-performance-team/stage2-coordinator-logs/resume-worker-typecheck.log 2>&1
(cd apps/web && node_modules/.bin/tsc --noEmit) > var/codex-performance-team/stage2-coordinator-logs/resume-web-typecheck.log 2>&1
(cd apps/web && node_modules/.bin/drizzle-kit check) > var/codex-performance-team/stage2-coordinator-logs/resume-migrations-check.log 2>&1
node scripts/diagnostics/coordinator-stage2-dependencies.cjs > var/codex-performance-team/stage2-coordinator-logs/resume-dependencies-final.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage2-python-benchmark.py var/codex-performance-team/stage2-coordinator-logs/resume-python-after.json > var/codex-performance-team/stage2-coordinator-logs/resume-python-benchmark.log 2>&1
PYTHONPATH=apps/api /home/ubuntu/miniforge3/envs/stockdepth/bin/python scripts/diagnostics/stage2-python-data-benchmark.py var/codex-performance-team/stage2-coordinator-logs/resume-data-after.json > var/codex-performance-team/stage2-coordinator-logs/resume-data-benchmark.log 2>&1
git apply --reverse --check var/codex-performance-team/stage2-python-logs/stage2-python.patch > var/codex-performance-team/stage2-coordinator-logs/resume-python-rollback.log 2>&1
git apply --reverse --check var/codex-performance-team/stage2-python-logs/stage2-python-resume.patch > var/codex-performance-team/stage2-coordinator-logs/resume-fix-rollback.log 2>&1
git apply --reverse --check var/performance/stage2-worker/stage2-worker.patch > var/codex-performance-team/stage2-coordinator-logs/resume-worker-rollback.log 2>&1
```

Python 274 passed、1 deselected、83 subtests passed、8既有warning；含双模型/供应商映射、费用/身份、计时/registry、进度/Checkpoint/原子写及两个新恢复测试。原失败脚本 content_equal/mtime_equal 均 true。Handler/RunPoller 联测10状态/4正文请求通过，覆盖正文变化、usage独立变化、Decimal/身份、新实例恢复、终态/失败日志、鉴权/路径。Worker 9轮询项目、隔离SQL增量同步和真实processJob监控路径均通过；阶段一15组隔离稳定性/凭据/未知费用/超时/竞争/无交易与积分不变通过。Web/Workers类型检查和Drizzle迁移链检查通过；0030–0034快照递归差异仅新增预期字段/约束/表/索引，prevId链一致，全部迁移仅应用在新隔离库。

本次新增 coordinator-stage2-dependencies.cjs 补验拟提交双模型前置功能：将实际 Web POST 路由与真实Drizzle/隔离PostgreSQL联用，认证用户和行情目录是明确夹具，GET列表不在该测试范围。实际价格读取、Zod校验、加密、快照、DTO、积分扣减与账本事务均运行原实现；覆盖401、角色拒绝400、缺选择400、跨供应商201/两把不同密钥、价格/参数快照不受配置更新影响、余额不足402无新增账本/任务、旧modelConfigId兼容201、缺测试Keyring503无扣费。隔离库finally删除，进程不启动Worker/模型；没有项目业务数据操作。使用已有esbuild/Next运行时，无依赖升级。

保留此次首次脚本失败：resume-worker-polling.log 为运行目录导致输出路径ENOENT，按交付目录修正后9项通过。依赖补验 resume-dependencies.log 为esbuild解析入口不正确，resume-dependencies-second.log 为既有迁移已插入pricing导致fixture重复主键；仅改协调测试加载与fixture upsert，最终重跑通过。没有把这些失败当通过，也没有改业务代码掩盖错误。

| 本次实测 | 历史覆盖前 | 续接后 |
| --- | ---: | ---: |
| 跨秒恢复（完整内容 / mtime相等） | false / false，退出1 | true / true，退出0 |
| 100重复事件，每轮替换 / 写字节 / dumps | 500 / 90,025,800 / 200 | 5 / 900,258 / 2 |
| 同场景耗时中位数 | 324.85 ms（历史独立前测） | 4.365 ms（三轮4.746/4.180/4.365） |
| 100轮状态数组编码 | 每轮300,196字节 | 每轮186字节，8.331 ms |
| 20历史OHLCV | CSV19、Mock下载1 | CSV0、Mock下载1，17.297 ms |
| 20当天OHLCV | Mock下载20 | Mock下载1，10.916 ms |
| 20历史区间 | Mock请求20 | Mock请求1，17.500 ms |
| Worker20轮 | 20正文、4,005,956字节 | 2正文+20状态、407,192字节 |

日期已跨北京时间午夜，OHLCV动态日期fixture的本次哈希不能和昨日直接比；正常数据输出一致性采用首次同日期前后对照证据，本轮未将不同日期哈希说成一致。跨秒修复前后重复事件计数已相同，本修复收益是恢复正确性，不声称新增性能加速。Mock收益不等于真实模型、Token、费用或实网行情收益；墙钟受主机竞争影响，可信结论仍是减少重复I/O与请求数量。

## 本次提交范围与推送门禁

receipt.commit_paths逐文件明确列出本阶段及已有双模型/阶段一依赖，逐文件SHA256和审查/验证映射记录在 stage2-coordinator-logs/resume-commit-review.json。提交包含前置功能：跨供应商Quick/Deep配置/快照/费用身份、Paper调用费用、租约/恢复/计时及0030–0034迁移，并非纯阶段二补丁。前置Python运行回归、Worker隔离业务断言、实际入队隔离验证与Web类型检查已补验；Web可视UI/管理员页面仅源码审查和类型检查，浏览器性能与最终长时运行留在阶段四，不宣称完成。历史报告和只读基线脚本是前置审查材料，未重新运行针对项目库的基线脚本。

清单不含.env、真实凭据、日志、var、node_modules或构建缓存；push-verified-dev.py已审查，要求dev、无既有暂存差异、明确路径清单、远端祖先检查、普通push和远端SHA一致，失败调度器blocked。协调者未亲自commit/push；receipt complete只代表阶段二独立验收通过，不能证明推送。调度器执行成功后才放行阶段三，失败必须停；无main/force push/部署授权。

风险沿用前述TTL、元数据版本、非跨文件事务快照、无fsync、真实运行未验证。回滚不基于HEAD：整阶段协调补丁已刷新，包含PLAN、本报告和三个协调诊断脚本；另有 stage2-coordinator-resume.patch，仅撤销本次协调续接，恢复首次blocked文档并删除新增依赖补验脚本。实现者整阶段/续接补丁均通过反向检查；恢复到已知缺陷版本不能用于继续阶段三。哈希与完整命令见handoff，未实际回滚或改库。
