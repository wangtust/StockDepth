# 第四轮：全平台共享股票目录与定时行情

## 前置提交与范围

第三轮交易并发、持久幂等及迁移已验收部署，先提交并推送 main：`96fb5af9df0471684305297a3515374d38e43b02`。
本轮必须保留其事务锁顺序、精确金额与重放结果，不覆盖原有两处未提交管理员表单改动。

目标：所有用户共享股票身份、行情和历史日线；关注列表、持仓、交易、任务、报告仍按用户隔离。
本轮不同步所有股票、财报、新闻，不引入实时流、Redis、外部队列、跨币种汇率或全市场爬取。

## 数据结构

1. `instruments`：股票身份、symbol/exchange、名称、报价币种、IANA 时区、状态、身份验证时间；交易所+规范代码唯一，不带 userId。不把裸代码一律猜成 NASDAQ；无法确认身份标记 unresolved，不能用于自动成交。
2. `instrument_sources`：instrumentId、vendor、vendorSymbol、映射状态、验证时间；保证来源代码映射唯一且可追溯。
3. `price_snapshots`：instrumentId、decimal 价格、币种、源行情时间 quotedAt、系统抓取 fetchedAt、来源、价格类型/交易时段；唯一约束避免重复同步。核心金额使用 numeric/精确转换，不用格式化字符串或JS浮点累计。普通价格与复权价格不能混合。
4. `daily_prices`：instrumentId、交易日、OHLC、成交量、来源、复权标识、抓取时间；首次有限历史（默认最近一年），后续增量及小窗口补抓修订，不每轮全量下载。
5. `market_sync_state`：股票+数据类别的最近成功、下次执行、尝试次数、错误摘要、领取租约/owner，允许不同类别独立调度；故障不覆盖成功数据，过期租约可恢复。
6. `market_sync_runs`（若单一state不足以留审计）：每批开始/结束、计数和错误摘要；不保存认证参数。

现有 watchlist/positions/analysisJobs/trades 增加 nullable instrumentId；AI交易新增 nullable priceSnapshotId 和不可变成交价。旧ticker等字段保留作历史兼容。迁移不得改现金、数量、历史成交价或回填猜测身份；已验证身份可单独幂等关联。所有新增表、索引、字段包含完整Drizzle迁移、snapshot/journal，空库与旧库升级均验证。

## 同步与读取

- 独立 market Worker，沿用项目 PostgreSQL/进程管理，不按每个用户各同步一遍。汇总有持仓、启用自动交易及活跃关注股票，去重；持仓优先，限制每批数量和供应商并发。
- 价格：交易时段默认30分钟；关注列表无持仓默认收盘后一次；休市不反复轮询，收盘数据延迟补抓。市场时区/午休/节假日须正确处理或明确保守降级，不能把星期判断宣传为完整交易日历。
- 股票身份：首次请求时排队获取，已验证资料默认每周检查。日线每日更新。Worker一次运行支持 `--once`，可mock测试，不启动收费模型。
- 优先复用现有yfinance等获取能力，新增结构化provider函数，不能从报告文本反向解析价格。实际数据源能力/时戳需先测试验证；只少量公共只读行情请求，不购买接口、不更换模型账号。
- 限流/超时/临时错误有有界退避，失败保留旧行情。无报价时间不能冒充“当前报价”；抓取时间不替代quotedAt。双Worker领取去重，崩溃恢复测试使用隔离库。
- 新建只读共享API和服务函数，不在普通页面GET中触发外部行情请求。用户搜索/读取共享资料，修改来源及手工强制同步只有管理员或内部Worker权限。
- 分析工具本轮可继续原获取路径；提供统一股票服务作为后续接入点，不能声称已经改造全部基本面/新闻读取。

## 前后端契约与分工

| 角色 | 文件范围 | 工作 |
| --- | --- | --- |
| backend | db/schema与迁移、新lib/market服务、api/market路由、专用Python结构化行情adapter、market Worker/管理注册、paper读取和AI执行服务、独立后端测试 | 共享表、同步、API、用户关联、估值和AI报价接入 |
| frontend | portfolio/page.tsx、新的共享股票页/独立客户端组件、dashboard导航、新前端mock | 股票查询展示、持仓报价时间/新鲜度/盈亏说明，保留交易幂等生命周期 |
| coordinator | 两位执行者完成后统一整合和测试、README/.env.example/结果文档、部署和Git收尾 | 审查、验证迁移及第三轮回归、部署、提交并推送main |

共享契约先定：

- `GET /api/market/instruments?q=&before=&limit=` 返回 `{ instruments: [{ id, symbol, exchange, name, currency, timezone, status }], nextCursor }`；认证用户只读；无密钥/完整vendor payload。支持有界搜索与分页。
- `GET /api/market/instruments/[id]` 返回 `{ instrument, latestQuote, dailyPrices, sync }`；latestQuote为空或包含 `{ id, price: decimal字符串, currency, quotedAt: ISO, fetchedAt: ISO, source, priceType, freshness: fresh|stale|unknown }`。日线有界查询，sync只公开时间/状态，不包含内部错误详情/凭据。
- `/api/paper` 原字段保持兼容；positions添加 `instrumentId`、`quote`（上面的latestQuote形状）和 `valuationStatus: valid|stale|missing|currency_mismatch|unresolved`。缺失/过期/不同币种不能冒充可靠收益；不要把不完整资产直接当0求和。
- 前端仅使用上述字段，兼容没有新增字段的旧响应；backend不编辑客户端，frontend不编辑API/schema。其他契约变化写入各自checkpoint供协调者适配。

## 估值与模拟成交

- 持仓估值使用共享快照，不把lastPriceCents成交/旧标记价宣传成最新市场价；不修改原成本及已实现PnL。
- 组合仍USD等单一币种，本轮无FX。报价币种不一致明确标记，自动执行暂缓，不直接相加或猜转换。
- 手动用户指定价格仍为明确的模拟输入，不静默改价。AI自动/手动执行决策使用验证通过的新鲜报价，在第三轮事务内锁后重新读取/检查并保存snapshot引用和成交价；模型建议价只保留为建议。
- 没有有效股票身份、行情缺失/过期/未来时戳/币种不符时AI执行跳过并记录理由，不返回“已成交”。休市规则与quotedAt检查结合，不把上次收盘价格当开盘新价。幂等重放仍返回原成交结果，不按新行情重新成交。
- 暂不增加收益曲线/每日组合快照；本轮先把当前估值、成本与报价来源显示正确。

## 验收、部署和Git收尾

先检查现有数据与source只读基线，写入测试证据。所有交易/Worker写入回归在新建隔离数据库，生产最多只读；不调用收费模型、不操作真实资产。完整初始化/升级、身份消歧、共享去重、用户隔离、重复同步、时间/币种/小数/复权校验、租约过期及错误退避、缺失报价处理、AI行情引用、第三轮24项并发/幂等兼容、前端mock以及web/worker类型检查和生产build必须验证。

构建通过后才可应用非破坏迁移并更新web；重启原已运行paper服务前确认空闲，不中断分析/API。market新服务仅行情同步，可在隔离验证和有界生产只读source验证后显式启动，首次生产批次限制股票数；部署关联不得改变真实现金/持仓/成交数据。不能安全部署的内容明确记录。

全部实现和必要验收通过后，协调者按明确文件范围提交本轮代码、迁移、测试、计划和结果文档，并推送GitHub main。先fetch检查分歧，禁止force push；远程改变则安全整合后重新验证。不得包含var日志、.env、凭据或原有admin/actions.ts/model-create-form.tsx改动。确认远程main提交等于本地，并记录SHA。测试未通过不为完成Git动作绕过验收。

## 持久执行与额度

在现有codex tmux三个team窗口执行；旧批次证据保留，新指令/状态/日志在 `var/codex-team-round4/`。明确session ID续跑，不使用--last。cron每15分钟检查，额度恢复时间已支持结构化字段和CLI文字时间；普通错误暂停。每角色最多12次额度重试，批次最长7天，验收提交推送完成后自动移除定时任务。

查看/停止：`python3 var/codex-team-round4/team.py status` / `python3 var/codex-team-round4/team.py stop`。

## 用户修订：以股票目录驱动同步

用户最新明确调整（优先于原第四轮同步范围）：以共享 instruments 股票目录为唯一同步集合。用户新增关注股票、分析股票或手动交易股票时，通过统一 ensureInstrument 幂等服务查询目录，不存在则创建 unresolved 目录记录、来源映射和同步state；验证身份异步进行，不在页面请求里抓外部行情、不猜交易所。同步 Worker 只从目录中的启用股票及其到期同步state领取，不每轮扫描watchlist/positions来发现或判断是否仍有用户引用。新增并发同股票入库必须唯一去重，quote/identity/daily各自nextRunAt，无法识别有界退避。历史股票从现有表做一次有界/幂等初始化，不每轮扫描；删除用户关注不删除共享股票也不自动停止维护。用户希望始终维护目录股票，新增显式同步启用/管理员暂停控制即可，禁止全市场抓取。不要将所有存量数据都30min同步：价格交易时段30min，资料周级、日线日级。同步测试增加零用户引用的启用目录股票仍更新、用户首次新增即排队、两个用户同股票只一份、重复新增不重复state、删除关注保持共享资料。此调整不改前端既定只读DTO，协调者完成统一验收和Git提交推送。

## 已排队第五轮数据库改进（第四轮提交推送后执行）

用户授权继续实施：金额bigint扩容和精确算术、跨用户/组合数据库归属约束、模型API Key认证加密和安全迁移、历史异常只读审计、默认dry-run数据保留工具。保留真实历史资产，不自动清洗，不在生产删除历史。第五轮由backend、security（frontend窗口）、coordinator分工，独立迁移/测试/构建/部署并验收提交推送main。

详细计划已保存 `var/codex-team-round5/plan.md`；第五轮启动时写入 `docs/optimization-plan-round5-2026-10-12.md`，避免混入本轮实现提交。cron已安装，严格等待第四轮coordinator complete且remote_verified，然后才启动新会话。状态命令 `python3 var/codex-team-round5/team.py status`。
