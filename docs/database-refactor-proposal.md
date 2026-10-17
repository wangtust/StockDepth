# 数据库改造建议（待实施）

核对日期：2026-10-16。依据本地 PostgreSQL 16.15 的 public 表、索引、真实数据、EXPLAIN ANALYZE 与 Web/Worker 读写代码。本文件是设计建议，不是已执行迁移。采样时后台进程仍运行，计数与耗时仅代表采样时刻。

## 1. 实际表清单

| 分类 | 表（采样行数） |
| --- | --- |
| 用户与验证 | users (8)、signup_email_verifications (0)、signup_email_limits (3) |
| 审计 | activity_logs (70)、admin_audit_logs (96) |
| 分析 | analysis_jobs (112)、analysis_reports (883)、analysis_decisions (99)、analysis_job_resumptions (22) |
| 模型与调用 | llm_model_configs (29)、analysis_model_calls (574)、paper_model_calls (0) |
| 积分与调度配置 | credit_transactions (126)、analysis_pricing (3)、analysis_worker_settings (1) |
| 行情 | instruments (37)、instrument_sources (37)、price_snapshots (879)、daily_prices (7986)、market_sync_state (111)、market_sync_runs (316) |
| 自选与模拟交易 | watchlist_items (11)、paper_portfolios (1)、paper_positions (3)、paper_trades (4)、paper_trade_requests (0)、paper_analysis_runs (9)、paper_trade_decisions (9) |

共 28 张业务表，不计 drizzle 迁移表。大多数表很小；当前重点是配置语义、历史可追溯性和入口一致性，而非分库、分表或分区。

## 2. 模型数据的四种职责

- llm_model_configs：管理员维护的当前配置，包括模型、端点、加密密钥、价格和可用状态。
- analysis_jobs：当前执行选择与执行配置快照；恢复任务优先读取快照，避免配置编辑后静默改变排队任务。
- analysis_model_calls / paper_model_calls：实际发生的调用、重试、Token、价格快照和估算成本。历史价格不能通过 JOIN 当前配置重新计算。
- analysis_job_resumptions：更换模型前后信息的审计。一次任务可能先后使用多套配置，单个任务的两个当前配置 ID 无法解释全部历史调用。

当前 immutableModelSnapshot 使用 JSON.stringify({...config, ...}) 复制整行配置，包含执行所需信息，也包含管理状态等字段。快照里的 apiKey 按现有约定加密。JSON 格式只作为容器，改成 jsonb 本身不会消除重复或自动提高性能。

## 3. 已确认的问题与兼容边界

1. analysis_jobs.model_config_id 与 quick_model_config_id 在本地全部相同（包括同时为空），属于可逐步退出的旧兼容字段，但 Worker、API 和管理员逻辑仍读取它，不能先删列。
2. provider/base_url 是任务级单值，而 Quick / Deep 可来自不同供应商；不能作为两个角色配置的共同权威来源。quick_model/deep_model 可保留为展示缓存，权威执行配置应指向明确版本。
3. 112 个任务仅 18 个同时有 Quick / Deep 快照；94 个无完整快照。103 个普通任务中 18 个有快照，9 个模拟分析任务全部没有快照。
4. apps/web/app/api/paper/analyze/route.ts 创建任务仍只写旧 model_config_id，不写双角色 ID 与快照。普通分析入口已写入快照。应先统一新任务写入规则。
5. 574 条 analysis_model_calls 中 259 条没有 model_config_id；其余非空 ID 没有发现孤儿。旧记录只能保留历史未知信息，不能强行设为 NOT NULL 或假定恢复到当前配置。
6. 当前模型快照总大小均值约 1176 字节（仅统计双快照非空任务）；analysis_jobs 总关系大小约 304 KiB，配置去重当前主要提升一致性与维护性，没有证据证明能显著提速。

没有历史证据的任务不能用今天的配置回填成“当时配置”。迁移应明确标为 legacy_unknown，并保留现有安全恢复限制。

## 4. 推荐目标结构：可变配置身份 + 不可变版本

建议新增 llm_model_config_versions，先新增，不立即移除旧字段。

```text
llm_model_configs
  id, name, is_active, is_default, quick_enabled, deep_enabled,
  unavailable_reason, retired_at, current_version_id, ...

llm_model_config_versions
  id, config_id, version, provider, base_url, model_name,
  model_options, encrypted_api_key, input_price, cache_price,
  output_price, created_at
  UNIQUE(config_id, version)

analysis_jobs
  quick_model_version_id, deep_model_version_id, ...

analysis_model_calls / paper_model_calls
  model_version_id (nullable for legacy), 实际调用信息与计费快照, ...

analysis_job_resumptions
  previous_quick_version_id, previous_deep_version_id,
  next_quick_version_id, next_deep_version_id, ...
```

规则：

- 修改执行参数、端点、密钥或价格时生成新版本；名称和可用状态等管理属性可直接更新。
- 版本创建后禁止更新执行字段；在服务入口及数据库写权限/触发器中落实不可变规则，不能只靠命名约定。
- 创建任务时，在同一事务中确认角色权限和可用状态，固定版本引用；版本和任务不能出现中间悬空状态。
- current_version_id 必须属于同一个 config_id，可用 (id, config_id) 唯一键与复合外键保证。
- 暂保留加密密钥随版本存储，沿用现有恢复语义；若要改成凭据版本引用，必须另行定义密钥轮换、撤销及旧任务恢复策略。
- 模型禁用/额度耗尽仍按配置身份管理；版本不可变不等于绕过可用性检查。自动换模逻辑要通过版本关联回配置身份。
- 调用保留当次计费快照及实际模型返回信息，即使它与选择版本存在差异也不应覆盖历史。
- 新调用写明确版本引用；旧调用无法可靠匹配时保留空引用，不能从当前任务配置反推。
- Quick / Deep 只有两个固定角色，先用两列引用；需要开放更多角色时再引入任务模型绑定表。
- 两种调用表目前有不同归属和业务流程，暂不合并，避免一个泛化表引入大量可空外键。

旧快照迁移只提取执行相关字段，不把管理状态当作版本身份。对敏感数据不输出明文；加密具有随机性，不能仅按密文判断是否同一配置，也不能只用 model_config_id 合并不同历史快照。无法可靠去重时宁可保留独立历史版本。

## 5. analysis_reports 索引评估

本地已有：

```sql
PRIMARY KEY (id)
CREATE UNIQUE INDEX analysis_reports_job_key_idx
  ON analysis_reports (job_id, report_key);
CREATE INDEX analysis_reports_job_user_idx
  ON analysis_reports (job_id, user_id);
```

以任务 121 / 用户 2 采样：

| 查询 | 实际计划 | 单次执行时间 |
| --- | --- | --- |
| job_id + user_id + report_key 查报告 | analysis_reports_job_key_idx，返回 1 行 | 0.019 ms |
| job_id + user_id 查元信息并按 id 排序 | analysis_reports_job_user_idx + 10 行内存排序 | 0.032 ms |
| 模型调用按 job_id 过滤并按 started_at 排序 | analysis_model_calls_job_call_idx + 40 行内存排序 | 0.074 ms |

这些是本地缓存条件下的数据库计划执行耗时，不包含网络、正文传输、反序列化和页面渲染，不是服务性能承诺。

报告最多 10 条/任务，现有索引足够当前查询。不要再加单独的 job_id 索引；已有两个联合索引均以它开头。也不要把 content 放进覆盖索引。

analysis_reports 总关系大小约 15.5 MiB，主表堆约 272 KiB，明显存在堆外大字段存储；pg_column_size(content) 均值约 14.4 KiB，最大约 191 KiB，这不是未压缩字符长度。PostgreSQL TOAST 支持大文本压缩及堆外存储，不必仅因 text 很大就拆正文表。

当前页面/详情接口已按需读取正文，继续保持；Worker saveReports 为比较变更会读取已有正文，未来若同步开销明显，可增加稳定内容摘要，比较元信息与摘要后再决定写入，并保证所有写入口一致维护摘要。

未来候选索引（均需真实负载或规模测试支持，当前不执行）：

- 跨任务的用户报告列表：依据实际分页方式建立 (user_id, id DESC) 等索引；当前没有这个主查询入口。
- 每个任务出现大量调用且有分页需求：(job_id, started_at, id)；同时把排序改为 started_at, id 保证分页稳定。
- 管理任务按 status 过滤且按 id 分页：(status, id DESC)；现有 (status, created_at) 不能直接提供这个排序。仅状态过滤且足够大时再衡量收益。
- activity_logs 的用户最近操作：(user_id, timestamp DESC)，已在 getActivityLogs 中确认查询形态，但目前仅 70 行。
- credit_transactions 的用户流水索引：等新增流水页面或对账查询明确后再按分页/时间条件设计，不能只为每个外键机械增加多个索引。
- 全文检索需要独立设计中文分词与检索范围，不能把正文普通 B-tree 当作全文检索方案。

保留 (job_id, user_id) 复合归属外键：它确保报告用户与任务用户一致。id+user_id 等复合唯一键即使表面与主键重叠，也可能被归属外键依赖，不能作为冗余索引直接删除。

## 6. 实施顺序与验收

### 第一阶段：统一写入，保持现有结构

修复模拟分析入口，统一生成 Quick / Deep ID 与加密快照；明确所有新任务两个角色都必须固定配置。覆盖普通分析、模拟分析、手工换模、自动换模、旧任务恢复入口；验证配置在排队后被编辑时，任务仍按原配置执行。避免从当前配置伪造旧快照。

### 第二阶段：新增版本表并双写

新增版本表、配置当前版本引用、任务/调用/换模版本引用。先允许历史记录为空；迁移当前配置和已有可靠快照。事务双写旧字段与新引用，读取优先版本、回退现有快照/旧限制。同步调整模型可用性判定、Python 执行参数、管理操作影响范围、调用上报与公开响应脱敏。

验收：空库迁移、旧库迁移、重复初始化、并发版本创建、不同供应商 Quick / Deep、价格变更后的历史成本、密钥轮换/撤销行为、归属约束、运行中任务和 Worker 重启恢复。API 响应不得包含加密凭据或完整执行配置。

### 第三阶段：切读并退出兼容字段

对比版本读取与旧快照读取结果；待部署中的所有 Web/Worker 读写端均切换后，再停止双写。旧任务完成兼容处理后，逐步删除 model_config_id、任务级 provider/base_url 和重复配置快照；quick_model/deep_model 作为展示缓存是否保留由查询收益决定。

删列迁移最后单独发布，并有已验证的备份恢复方案。新增阶段回滚可继续用旧字段；新版本任务的回滚必须依赖双写完成的快照，不可只回退代码。不得在还有旧实例运行时移除字段。

### 第四阶段：根据负载优化

当前不分区、不合并两种调用表、不迁移报告到对象存储、不删除任务 Token 汇总。汇总是列表读取缓存，由调用明细在同一事务内维护；继续保留完整性标志，避免把未知用量视为零。

在真实 SQL 上比较执行计划、分页延迟、正文传输大小、Worker 同步读写量和索引写入成本。报告/调用持续增长到能证明瓶颈后，再选择新增索引、摘要列或归档。

## 7. PostgreSQL 依据

- 联合索引及最左列：https://www.postgresql.org/docs/16/indexes-multicolumn.html
- TOAST 大字段存储：https://www.postgresql.org/docs/16/storage-toast.html
- 覆盖索引、宽列与可见性限制：https://www.postgresql.org/docs/16/indexes-index-only-scans.html
