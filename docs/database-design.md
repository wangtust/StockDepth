# StockDepth 数据库设计与 ER 图

更新日期：2026-10-15。以 schema.ts、截至 0039_neat_dagger.sql 的全部迁移和迁移后的本机 PostgreSQL 元数据核对。
当前 **28 张业务表、54 个物理外键**，未验证约束 **0 条**。drizzle.__drizzle_migrations 不计入业务表。

2026-10-16 补充：上段及下方ER图是原库0039历史快照；当前服务使用stockdepth_dev数据库（V2库原地重命名），为V2兼容结构，共30张业务表、72个已验证物理外键，新增计费账户与模型版本。原stockdepth保留，旧数据尚未导入。本地Git dev分支为后续开发基线。当前实施范围、命令与后续清理边界见 [V2落地说明](database-v2-rollout.md)，完整目标字段见 [V2设计](design/database-v2.md)。

完整字段与外键图：[database-er.mmd](database-er.mmd)。图中 nullable 表示字段可为空，复合外键以约束名标识；联合唯一索引不能仅通过单字段 UK 标识理解。

## 表清单

| 表 | 用途 |
|---|---|
| `activity_logs` | 用户操作记录 |
| `admin_audit_logs` | 管理员操作审计 |
| `analysis_decisions` | 最终交易建议提取 |
| `analysis_job_resumptions` | 更换模型继续的加密审计 |
| `analysis_jobs` | 分析任务及模型快照 |
| `analysis_model_calls` | 模型调用、Token 和价格快照 |
| `analysis_pricing` | 分析深度对应额度 |
| `analysis_reports` | 每个任务各类型的当前报告 |
| `analysis_worker_settings` | 管理员任务并发配置 |
| `credit_transactions` | 用户额度流水 |
| `daily_prices` | 每日 OHLCV 行情 |
| `instrument_sources` | 行情供应商代码映射 |
| `instruments` | 全局股票身份 |
| `llm_model_configs` | 模型、加密凭据、价格和可用状态 |
| `market_sync_runs` | 行情同步批次记录 |
| `market_sync_state` | 行情同步调度和重试 |
| `paper_analysis_runs` | 模拟账户分析执行 |
| `paper_model_calls` | 模拟交易模型用量 |
| `paper_portfolios` | 模拟账户及现金 |
| `paper_positions` | 模拟持仓 |
| `paper_trade_decisions` | 模拟交易决策及执行状态 |
| `paper_trade_requests` | 交易幂等请求 |
| `paper_trades` | 模拟成交记录 |
| `price_snapshots` | 报价快照及成交证据 |
| `signup_email_limits` | 验证码发送频率限制 |
| `signup_email_verifications` | 注册验证码摘要与失败次数 |
| `users` | 用户、角色和分析额度 |
| `watchlist_items` | 用户自选股 |

## 归属与唯一性

- analysis_reports 的 (job_id, user_id) 引用 analysis_jobs(id, user_id)，并限制 (job_id, report_key) 唯一。报告 content 继续使用 text。
- credit_transactions.user_id 非空；可选的 (job_id, user_id) 必须匹配分析任务归属。充值、赠送和人工调整允许没有 job_id。
- 模拟账户、持仓、成交、执行记录的复合归属外键保留，迁移 0039 已逐项验证先前 NOT VALID 的约束。迁移不会自动清理历史异常；违反约束时整笔迁移失败。
- users.analysis_credits 不得为负；分析基准日期仍使用 varchar，API 和数据库检查共同拒绝非法日历日期，允许非交易日。
- 股票身份仍以 instruments(exchange, symbol) 唯一，行情序列按股票、交易日期、来源及复权口径区分。

## 积分事务与历史口径

管理员调整在同一事务内锁定用户并更新余额、写入实际变动流水、写入审计。余额不足时整笔拒绝，不静默截断。审计记录申请金额、实际金额、前后余额和备注。
新注册、初始管理员和开发种子用户的初始额度均在创建账户的事务中记录流水。历史余额不反向推断，不补造历史期初赠送流水；历史对账需另行确认期初值。
充值、分析扣费和邀请奖励沿用各自原有事务；本轮不改历史 Token、模型价格快照或成交金额。

## 时间与日期

实际发生时间目前包含 timestamp 和 timestamptz 两种类型。当前连接及写入采用 UTC 约定，展示按指定时区转换；未对历史 timestamp 做批量时区转换。
trade_date 是分析基准日期，不保证为交易所开市日。字段暂不改成 date，以保持现有 Python/API 契约；真实日期由输入校验及 CHECK 保证。

## 新机与旧库部署

先准备 PostgreSQL 空数据库、账户和根 .env，再运行 ./bin/stockdepth build 与 ./bin/stockdepth start。启动执行全部迁移，创建表、索引和约束；重复启动不会清空数据。schema.ts 用于 ORM 和生成迁移，实际部署依据迁移 SQL。
空库不带入开发用户、报告、行情、模型用量或交易记录。迁移自带必要的默认配置；配置 STOCKDEPTH_ADMIN_EMAIL / PASSWORD 时，另外创建管理员和初始额度流水。数据库服务与数据库本身仍需预先创建。

## 验证

scripts/tests/database-integrity.ts 使用独立临时数据库运行真实初始化器两次，验证空库结构、旧库升级、归属/唯一性/日期约束、NOT NULL、积分并发扣减、审计失败回滚和初始赠送流水。包含脏数据的升级会失败并保留原记录。
旧验收文档中的表数量是当时的快照，不作为当前数据库清单。
