# 2026-10-12 性能诊断

本次从服务器本机访问网页，使用有任务的普通用户会话。HTTP 数据每组先预热一次，再测三次取中位数。测试不创建分析任务、不调用收费模型。样本少，结果用于定位瓶颈，不代表容量测试或用户公网延迟。

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 页面 HTML | 1430 ms | 1045 ms |
| 任务列表接口 | 1761 ms | 923 ms |
| 报告详情接口 | 2297 ms | 1831 ms |
| 数据库 `SELECT 1` 往返 | 216 ms | 228 ms |
| 列表 SQL 服务端执行 | 0.135 ms | 0.136 ms |

列表 SQL 的 EXPLAIN 使用按用户过滤、ID 倒序、LIMIT 50 的基础查询，不包含完整列表接口的报告计数 JOIN。详情响应约 263 KB，列表响应约 28 KB。接口的时间主要花在响应头返回之前。

检查时 CPU 约 93–98% 空闲，可用内存约 695 MB，swap 使用约 2.1 GB。swap 使用量本身不能证明当前发生严重内存抖动，短时 vmstat 显示少量换入。

浏览器首轮测试（包含部分开发模式接口编译）显示：首次任务可见约 7.36 秒，详情响应完成约 12.02 秒，JavaScript 网络传输约 3.30 MB，主线程长任务累计约 1.50 秒，没有 pageerror。第二轮浏览器测量首次任务可见约 7.17 秒、详情响应完成约 10.43 秒，页面 TTFB 波动到约 4.61 秒，长任务累计约 0.97 秒，仍无 pageerror。这表明首屏尚未彻底解决，不能用接口改善幅度推断浏览器整体同比改善。服务器本机浏览器测试不等于用户电脑的真实加载时间。

## 已实施

- 列表的任务、价格、模型查询并行执行。
- 校验任务归属后，详情的报告和调用记录查询并行执行。
- 价格和并发设置读取不再每次都先做初始化 INSERT，只有缺失时补齐。
- React 服务端渲染期间，用 request-scoped cache 复用当前用户查询。没有跨用户缓存。
- 列表刷新不再通过 updatedAt 变化重复重启详情请求，已有实时详情轮询继续工作。
- 浏览器隐藏标签页停止周期轮询。
- worker 只在内容变化时保存报告、同步 usage；只 upsert 有变化的模型调用。统计仍从数据库内该任务所有历史调用聚合，保留 Continue 累计用量和价格快照。
- 列表、详情接口返回 Server-Timing，区分 auth、jobs/job、pricing、models、reports、calls 和 total；并行阶段不能简单相加。

## 如何复测

激活项目环境，在项目根目录运行：

```bash
node scripts/diagnostics/latency.cjs
```

可通过 STOCKDEPTH_DIAGNOSTIC_SAMPLES 设置 1–10 次采样，STOCKDEPTH_DIAGNOSTIC_URL 设置网站地址。脚本输出仅包含耗时、状态码和响应大小，不输出会话、数据库密码和报告内容。

浏览器诊断需要独立的 Playwright 安装，不进入应用运行依赖：

```bash
npm install --prefix /tmp/stockdepth-performance-tools playwright
/tmp/stockdepth-performance-tools/node_modules/.bin/playwright install --with-deps chromium
node scripts/diagnostics/browser-latency.cjs
```

可用 STOCKDEPTH_PLAYWRIGHT_MODULE 指定其他 Playwright 模块路径。脚本只访问页面，不操作任务。

scripts/diagnostics/read-load.k6.js 是可选的只读 k6 压测脚本，默认两个虚拟用户、20 秒。需要自行提供有效的临时 SESSION 环境变量。该压测尚未运行；不要把登录 cookie 写进仓库或共享报告。

浏览器开发工具 Network → 接口请求 → Timing/响应头可查看 Server-Timing；Performance 可录制刷新到报告出现期间的主线程耗时。

## 后续优先级

1. 生产环境改用 `next build` + `next start`。目前仍是 `next dev --webpack`，有运行时编译、热更新和较大的开发脚本。本次没有部署生产构建；现存 Stripe API 版本类型不匹配仍阻止完整类型检查。
2. 把数据库和应用尽可能放在同地域、低延迟网络。网络往返已有约 0.22 秒，即使 SQL 执行很快，也会叠加到每个请求。本次没有迁移数据库。
3. 对真实用户浏览器记录公网 TTFB、FCP/LCP 和主线程长任务，再决定是否进一步拆分报告脚本、按需取报告或虚拟化长列表。
4. 若要验证多人访问，先用只读 k6 按小并发逐级测 p50/p95、错误率、内存和数据库连接；再单独测试分析 worker 容量。200 是调度配置，不是本机已验证的承载能力。
5. 跨 web、worker、Python API 的持续追踪可用 OpenTelemetry；数据库慢 SQL 可用 pg_stat_statements。本次发现数据库未安装该扩展，没有修改数据库服务器的全局配置。

验证：usage/cost Python 测试 11 项通过；网页页面、脚本和用户接口读取正常；web/worker 类型检查仍只报告之前已有的 Stripe API 版本错误。

## 本机工具安装与重测

已安装 k6 2.3.0（`~/.local/bin/k6`）、Playwright/Chromium（独立安装在 `/tmp/stockdepth-performance-tools` 与 `~/.cache/ms-playwright`），以及应用依赖 `@vercel/otel` 2.1.3。Chromium 所需系统动态库也已安装。

启用 `.env` 中 `STOCKDEPTH_TRACE_LOCAL=true` 后，网页服务将 OpenTelemetry span 名称、traceId、耗时和状态写入 `var/performance-spans.jsonl`，不导出属性、请求头、提示词、响应内容或 SQL。文件超过约 5 MB 后在下一批导出时覆盖。当前只接入 web，不是完整的 Python/worker 分布式追踪。修改此开关需要重启 web。

接入追踪的首轮发现了 Node/Edge 打包兼容错误，出现 500。代码隔离到 instrumentation-node.ts 后重启恢复；这轮失败和编译等待没有混入以下稳定测试的结果。

- k6：2 个虚拟用户，20 秒，只读任务列表，13 个请求全部成功；中位数 1.31 秒，P95 1.92 秒，最大约 2.49 秒。样本很少，未验证 200 个分析任务容量。
- Chromium 重测：任务列表可见约 4.06 秒，详情响应完成约 5.48 秒，TTFB 1.00 秒，FCP 1.22 秒；JS 传输约 3.30 MB；长任务累计 0.66 秒，无 pageerror。
- 带追踪的本机 HTTP 重测中位数：页面约 1.91 秒，列表约 1.35 秒，详情约 2.03 秒。测试同时有浏览器访问、开发编译及其他现有用户访问，因此不能把它与此前独立采样差值全部归因于追踪开销。
- 已确认远程数据库 `pg_stat_statements` 未安装且 shared_preload_libraries 为空。扩展需要数据库服务器端预加载并重启，本次没有配置远程数据库服务器；仍使用 EXPLAIN 和 SELECT 1 网络往返测试。

复测命令：

```bash
node scripts/diagnostics/latency.cjs
node scripts/diagnostics/browser-latency.cjs
node scripts/diagnostics/run-load.cjs
```

`run-load.cjs` 自动在本机生成临时测试会话，以环境变量传给 k6，不打印 cookie。设置 `VUS=5` 可测五个浏览用户；脚本最多十个，默认两个。k6 汇总在 `var/k6-read-summary.json`。这些测试只读，不会创建任务或额外调用收费模型。

## 后续实施与验证（生产模式）

以下是本次后续工作的结果。原记录保留，避免把旧的开发模式数据误认为当前状态。
测试来自服务器本机，HTTP 每组预热一次、采样三次；最终浏览器三轮的任务可见时间
为 904 / 922 / 906 ms，中位数 906 ms。数据库网络有偶发长尾，短测不能作为公网 SLA。

| 指标 | 本轮修改前 | 最终结果 |
| --- | ---: | ---: |
| 浏览器首次任务可见 | 3795 ms | 三轮中位数 906 ms |
| 报告加载 | 全量详情响应结束 5962 ms | 选中正文可见三轮中位数 3412 ms；范围 1851–3909 ms |
| JS 网络传输 | 3,300,519 B | 228,824 B |
| 列表响应 | 28,600 B，最多 50 条 | 约 9300 B，20 条摘要及下一页游标 |
| 同一任务 #95 的详情响应 | 263,179 B，所有正文 | 7321 B，正文另行获取 |
| 列表 HTTP 中位数 | 1503 ms | 最终两轮 434 / 451 ms |
| 同一任务 #95 的详情 HTTP 中位数 | 2499 ms | 最终两轮 433 / 449 ms |
| Web RSS | 开发进程单次约 855 MiB | 生产读取压测峰值 235–253 MiB |
| 数据库 SELECT 1 往返 | 212 ms | 约 218–225 ms，网络仍有长尾 |

报告口径有所变化：修改前测的是全量详情的网络完成，最终测的是单个正文返回并在
article 中可见。测试期间出现了新的空报告任务，因此诊断现在会选择已有保存报告的
任务；最终可比测试用 `STOCKDEPTH_DIAGNOSTIC_JOB_ID=95` 固定报告，并在列表出现后
选择它，选择动作也计入正文可见时间。未把整份报告拆小后的响应大小解释为相同内容压缩。
HTML 因包含首批任务和序列化数据，从约 45 KB 增到约 85 KB，换掉了首屏列表请求等待。

### 逐步实施

| 阶段 | 浏览器任务可见 | 详情/正文 | 列表 k6 P95 | 备注 |
| --- | ---: | ---: | ---: | --- |
| 新基线：开发模式 | 3795 ms | 全量详情 5962 ms | 1950 ms，14 次 | 原始 JS 3.30 MB |
| 仅生产构建 | 9244 ms | 全量详情 11393 ms | 未单独采集 | JS 已降到 227 KB；数据库往返波动 230–1194 ms，不能归因于构建退化 |
| 合并读取、池与分页索引 | 2885 ms | 全量详情 4786 ms | 2620 ms，13 次 | 列表约 8.8 KB，尚未 SSR 首批数据 |
| 服务端首批数据 | 2048 ms | 全量详情 4925 ms | 1502 ms，14 次 | 页面首次即可显示 20 条任务 |
| 按需加载首次验证 | 验证失败 | 报告目录错误为空 | 2232 ms，13 次 | 修复前数据排除出改善结论 |
| 修复并统一 SWR | 1672 ms | 目录 4388 / 正文 6746 ms | 1860 ms，14 次 | 正文当时仍等目录返回 |
| 默认章节与详情并行 | 1744 ms | 目录 3181 / 正文 4428 ms | 2012 ms，14 次 | 缓存按用户隔离 |
| 预编译、最终验证 | 三轮中位数 906 ms | 正文中位数 3412 ms | 2 用户两轮 695 / 1779 ms，17 / 15 次 | 5、10 用户及混合读取见下表 |

按需加载首次失败是本次改动引入的问题：Drizzle 在单表选择中移除了嵌套 SQL 的
列限定名，子查询把报告的 id 当成了外层任务 id。已明确使用 `analysis_jobs.id`
修复关联，并增加报告目录、正文及历史调用与数据库一致性的回归测试。
另一次预编译阶段的浏览器诊断遇到最新任务尚无正文，等待正文超时；诊断改为明确
选择已有报告的任务，该失败轮同样不纳入正文性能结论。小样本 P95 并非每阶段单调改善。

1. **生产运行**：Next 固定为稳定版 15.5.27；Stripe 固定为匹配已有 API 版本
   `2025-04-30.basil` 的 18.1.0，支付 API 版本未变。所有 JS 直接依赖固定版本，根锁文件
   冻结安装通过；原生依赖构建许可已记录到 pnpm-workspace.yaml。`bin/stockdepth build`
   运行 next build，start 运行 next start，缺少生产构建时拒绝启动。开发输出改用 .next-dev。
2. **数据库**：每进程复用连接池，默认 5 个连接。列表在鉴权后用一次 SQL 读取任务、积分、
   价格和模型；先 LIMIT 21 再计算报告摘要，返回 20 条及游标。详情目录与历史调用合并读取。
   发现 postgres-js unsafe 默认关闭预编译；同一参数查询关闭时约 450 ms，开启并预热后约
   226 ms，省掉一次 Describe 往返。连接代理不支持时可设 STOCKDEPTH_DB_PREPARE=false。
3. **首屏**：服务端通过请求范围的当前用户读取提供初始任务；前端不再串行等待初始列表。
   默认章节标识随摘要返回，让详情和正文并行请求。分页不会传递 runId、runner 日志或正文。
4. **按需加载**：报告及分析过程按所选 reportKey 获取；渲染组件动态加载。管理员费用先用
   PostgreSQL numeric SUM 汇总所有历史已知费用，缺失费用不变成已知零；展开时才请求明细。
   价格快照保持每次调用的原值。普通用户接口不返回费用、原始 usage 或价格快照。
5. **轮询**：任务、目录、正文通过 SWR 去重；运行时刷新，详情完成后停止周期刷新，隐藏及
   离线暂停。焦点恢复与手动 Refresh 可以重新验证。根缓存以当前用户 ID 隔离，退出清空。
   管理员轮询读取轻量活动签名，变化后刷新页面；完成的详情停止活动轮询。
6. **Worker**：本机默认上限 4，与管理员系统并发取较小值；同供应商/endpoint 同时运行最多
   2 个。可用内存不足 256 MB 时暂停领取新任务，保留已有任务监测和恢复。每 30 秒记录
   Worker 与 Python runner RSS、可用内存、队列长度、最长等待；设置查询缓存 30 秒。
   Python runner 之间用本机文件锁共享初始模型调用节奏，默认 60 次/分钟，可按供应商配置。
   SDK 内部重试仍使用退避，可能增加实际 HTTP 请求数；它不是多机共享限流。
   Worker 的只读 API 请求最多四次尝试，指数退避、抖动和 Retry-After；启动分析 POST 不重放，
   避免首次运行已完成时重复发起收费分析。Token/费用聚合与 Continue 的历史统计逻辑保持原值。
7. **验证**：各阶段保存 HTTP、浏览器、k6、RSS 结果；最终阶段每秒采样进程 RSS。
   Server-Timing 可见预热后的 auth 与 jobs 各约 220 ms。实际完整列表 SQL 的 EXPLAIN
   使用生产同一查询构造器，三次执行 0.796 / 0.743 / 0.751 ms；报告索引用于计数及默认章节。
   最新 100 个本地 web trace 样本没有错误 span，不把它称为 Python/Worker 全链路追踪。

迁移 `0024_daily_lilandra.sql` 增加可见用户任务分页索引和报告 job/user 索引，包含 journal
与 snapshot。独立空数据库从所有迁移初始化，验证 16 张表，执行 mock Worker 后自动删除。
没有手改现有任务、历史调用或费用数据。

### 读取负载与 Worker 容量

以下读取压测都没有失败请求，1 次迭代之后仍 sleep 2 秒，代表该访问节奏下的用户数，
不是无等待的极限吞吐或分析任务并发数。

| 读取负载 | 时长 | 请求数 | P95 | Web RSS 峰值 |
| --- | ---: | ---: | ---: | ---: |
| 5 用户列表，预编译前 | 30 秒 | 49 | 2196 ms | 当时只记录前后快照 |
| 5 用户列表，预编译后 | 30 秒 | 61 | 884 ms | 242 MiB |
| 10 用户列表，预编译后 | 30 秒 | 121 | 1114 ms | 235 MiB |
| 5 用户列表+目录+正文 | 30 秒 | 135 | 总体 864 ms；列表 860 / 目录 862 / 正文 867 ms | 253 MiB |

独立数据库 mock 测试每档 8 个任务，真实执行队列领取和报告持久化，但不启动模型和
Python 分析进程。最终结果如下；最后一轮部分测试与生产构建重叠，适合验证功能与
容量边界，不能据小差异给 2/4 并发排名。

| 配置并发 | 全部完成耗时 | 最大排队 | 执行 P95 | 实际观察运行峰值 | Worker 进程树 RSS 峰值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 23.67 秒 | 20.11 秒 | 2.53 秒 | 1 | 140 MiB |
| 2 | 15.20 秒 | 13.00 秒 | 2.40 秒 | 2 | 144 MiB |
| 4 | 15.95 秒 | 12.68 秒 | 2.41 秒 | 3 | 141 MiB |

之前独立轮曾观察到 4 个运行任务，8 个任务全部成功，但并发 4 未稳定呈现比 2 更高的
吞吐。配置 200 仍不能被解释为本机已验证的承载量。真实模型/Python runner 的内存、
供应商额度和收费分析容量没有压测，本次没有额外调用收费模型。
最终运行监测已观察到一个现有分析任务：Python runner RSS 约 110 MiB、Worker 约
103–105 MiB、队列为 0。这证明监测已接入正常任务，单个瞬时样本不能代表真实分析峰值或容量。

远程数据库未安装 pg_stat_statements。读取统计工具明确输出不可用；配置它仍需要数据库
服务器的预加载和重启，本次没有远程服务器管理入口，也没有执行这项全局变更。
当前证据支持“网络和协议往返占主导”，没有发现生产列表 SQL 本身很慢。

### 回归及复测

已通过：生产完整构建、web/worker 类型检查、冻结锁文件安装；32 项 Python 回归覆盖
Token、费用、检查点恢复、跨进程限流、网关超时和供应商兼容；HTTP 回归覆盖权限、删除、
恢复、游标、历史用量及正文一致性；Playwright 用模拟响应/可见性验证请求去重、后台暂停、
焦点恢复和完成停止；本地 HTTP 服务验证退避、401 不重试、分析启动 POST 不重放。

```bash
# 如果示例任务不属于当前诊断用户或不在第一页，去掉固定 ID 或指定该用户的保存报告任务。
STOCKDEPTH_DIAGNOSTIC_JOB_ID=95 node scripts/diagnostics/measure-stage.cjs repeat
VUS=10 DURATION_SECONDS=30 node scripts/diagnostics/measure-stage.cjs read-ten
READ_DETAILS=true VUS=5 DURATION_SECONDS=30 node scripts/diagnostics/measure-stage.cjs mixed-five
node scripts/diagnostics/database-stats.cjs
"$STOCKDEPTH_RUNTIME_BIN/tsx" scripts/diagnostics/database-query-plan.ts
node scripts/diagnostics/worker-capacity.cjs
node scripts/tests/analysis-read.cjs
node scripts/tests/job-visibility.cjs
node scripts/diagnostics/polling-regression.cjs
"$STOCKDEPTH_RUNTIME_BIN/tsx" scripts/tests/worker-request.ts
```

阶段原始结果位于 `var/performance/<阶段>/`；最终逐秒 RSS 记录为 memory-samples.json，
不包含命令行、Cookie、提示词或报告正文。Worker 容量结果为 var/performance/worker-capacity.json。
var 不进入 Git，以上汇总进入本文件。验证权限/恢复的脚本临时写入 failed 测试任务并自动
清理，不扣积分；容量脚本需要创建/删除测试数据库权限，并自动清理测试库。
