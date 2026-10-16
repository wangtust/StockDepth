# StockDepth 数据库 V2 目标设计

日期：2026-10-16。状态：完整目标设计；30表的兼容阶段已实施并切换到stockdepth_v2，尚未完成全部目标字段清理。实际落地范围见 [V2落地说明](../database-v2-rollout.md)。依据原有28张业务表、实际Web/Worker查询、支付和模拟成交事务设计。

本稿是此前 database-refactor-proposal.md 的完整目标结构扩展。推荐 **30 张业务表**：保留现有 28 张表的业务边界，增加 billing_accounts 和 llm_model_config_versions。表的数量不是性能指标；性能目标是小范围定位、控制列表读取量、减少重复配置和不必要的写锁竞争。

目标关系图：[database-v2-relations.mmd](database-v2-relations.mmd)。关系图为业务主关联概览，完整复合归属约束及 NULL 例外以本文逐表说明为准。

## 1. 全局约定

- `?` 表示允许 NULL，未标记的字段全部 NOT NULL；每表列出的字段构成完整目标字段集。
- `id` 默认为 integer identity 主键；保留现有 ID 和外部接口范围。Token、成交金额、成交量和账本序号使用 bigint；不为了统一而把所有 ID 改成 UUID 或 bigint。高增长表接近 integer 容量前再单独规划扩容。
- 实际发生时间统一 timestamptz，连接使用 UTC；客户端按时区显示。分析基准日和行情日期使用 date。timestamp 历史值必须先确认写入时区，不能直接依赖迁移连接时区隐式转换。
- 状态使用 text + CHECK，避免随意字符串；明确允许值后再收紧旧数据。外部供应商原始状态允许 text，不能强制塞进内部状态枚举。
- 金额不使用 float：行情 numeric(24,8)，模拟账户美元/港元/人民币分使用 bigint，模型单价 numeric(15,6)，模型估算费用 numeric(24,12)。币种明确保存；跨币种不直接加总。
- 所有 *_cents 继续遵循当前 JavaScript 安全整数边界 ±9007199254740991，计算中间值使用 BigInt。API 的 bigint/numeric 使用明确序列化规则；Token/ID/序号超出安全整数时返回十进制字符串，禁止静默 Number 转换。
- jsonb 只用于模型参数、原始用量、价格证据、账户上下文等结构可变数据；核心过滤和关联字段单独建列。报告正文和原始非结构化响应用 text。
- 可变表的 updated_at 用统一 BEFORE UPDATE 触发器维护（业务字段有实际变化时才刷新）；不把心跳当业务更新时间。追加审计/流水/版本不允许普通更新。原始模型调用在完成前允许补齐用量，完成后仅走受控修正。
- PK/UNIQUE 自动拥有索引；下文仅列额外查询索引与业务唯一性。外键不自动给引用端建索引，按访问与删除策略逐项设计。
- 审计、积分、成交数据默认 RESTRICT，账号软删除；清理运行数据按依赖显式执行。不能以 CASCADE 连带删除财务与成交历史。
- 保留 user_id 等有价值的归属冗余，并用复合外键确保它与父记录归属相同。减少字段不能以丢失数据库归属约束为代价。
- 文中“目标索引”表示与目标查询一起交付的候选最小集合；新增/替换须与旧索引比较真实及放大数据的 EXPLAIN，不能将清单全部叠加到现有索引上。

## 2. 用户、计费与验证：6 张

### 01 users：身份与权限

```text
id integer PK identity
email varchar(255)
name varchar(100)?
password_hash text
invite_code varchar(6)?
referred_by_user_id integer? FK users.id
role text = 'member'
status text = 'active'
created_at timestamptz = now()
updated_at timestamptz = now()
deleted_at timestamptz?
```

- email 写入时统一 trim/lower，CHECK(email = lower(btrim(email)))；UNIQUE(email)。软删除继续释放邮箱时，明确重写格式及长度边界。
- UNIQUE(invite_code)；CHECK role IN ('member','admin','super_admin')，status IN ('active','disabled')；推荐码不能指向自己。
- referred_by_user_id 保存直接邀请关系，注册后固定；旧用户无法证明邀请来源时保持 NULL，不从积分奖励反推。
- 积分与 Stripe 信息迁到 billing_accounts。鉴权只读取身份列，不必加载账务信息。
- 按推荐关系的统计尚非主入口，不立即为 referred_by_user_id 加统计索引。

### 02 billing_accounts：一个用户一个积分/计费账户（新增）

```text
user_id integer PK FK users.id
analysis_credits integer = 0
ledger_sequence bigint = 0
ledger_opening_balance integer = 0
ledger_opened_at timestamptz = now()
stripe_customer_id text?
stripe_subscription_id text?
stripe_product_id text?
plan_name varchar(50)?
subscription_status varchar(40)?
created_at timestamptz = now()
updated_at timestamptz = now()
```

- CHECK credits/opening_balance/ledger_sequence >= 0；Stripe customer/subscription 各有非空唯一索引。
- 保留现有订阅兼容字段，因为代码仍处理订阅回调和客户门户。当前售卖积分包，不另建套餐、订阅历史、订单中心；出现明确需求再拆。
- 余额是事务维护的快速读值，不能每次扣费都 SUM 历史流水。扣费使用条件 UPDATE credits >= cost，或先锁账户；更新余额、递增序号和写流水在同一事务。
- 所有账务写入口统一锁顺序：必要时 users SHARE 验证账号，再 billing_accounts UPDATE；邀请双账户按 user_id 升序锁定。避免不同入口反向拿锁。
- 新用户账户从 0 开始，赠送 10 分通过一笔真实流水完成，不再依赖 users 默认余额。
- 历史迁移在阻断旧账务写入/受控切换期间取实际余额为 opening_balance，sequence 从 0 开始；旧流水 sequence=NULL。它是“切换时余额基线”，不是伪造过去的赠送。新账本余额 = opening_balance + SUM(sequence 非空的 amount)。旧账本另行核查。
- 分离此表降低账务更新与用户资料/鉴权锁的耦合，但同一账户扣费仍需串行，不能承诺拆表后吞吐自动翻倍。

### 03 credit_transactions：积分事实流水

```text
id integer PK identity
user_id integer FK billing_accounts.user_id
job_id integer? FK analysis_jobs.id
ledger_sequence bigint?
amount integer
balance_after integer?
reason varchar(80)
operation_key varchar(160)?
stripe_checkout_session_id text?
metadata jsonb = '{}'
created_at timestamptz = now()
```

- CHECK amount <> 0，balance_after >= 0，ledger_sequence > 0；sequence 与 balance_after 必须同时为空或同时非空。新记录必填二者，旧记录允许两者皆空，通过写入服务/权限隔离历史例外。
- UNIQUE(user_id, ledger_sequence)（非空）；UNIQUE(user_id, operation_key)（非空）；Stripe session 全局非空唯一。
- (job_id,user_id) 复合外键引用 analysis_jobs(id,user_id)，防止把扣费记到其他用户任务。
- 索引：(user_id, id DESC) 支持流水游标分页；(job_id,user_id) WHERE job_id IS NOT NULL 支持任务对账/归属引用。前者与 sequence 唯一索引用途不同：它也覆盖无 sequence 的历史。
- operation_key 例：analysis-charge:任务ID、signup:用户ID。退款需要引用原流水/原因，避免仅靠 reason 去重；在 metadata 保存源流水 ID，并在退款入口校验额度。
- 不存明文支付凭据；metadata 保存必要业务解释，不代替核心列。

### 04 analysis_pricing：分析深度定价

```text
depth smallint PK
label varchar(40)
credit_cost integer
updated_at timestamptz = now()
```

- CHECK depth > 0，credit_cost > 0。沿用当前深度 1/3/5，但不硬编码成永远不可扩展的三值类型。
- 任务保存实际 charged_credits，流水保存实际扣减，不用当前定价重算旧任务。

### 05 signup_email_verifications：注册验证挑战

```text
email varchar(255) PK
code_hash varchar(64)
expires_at timestamptz
attempts smallint = 0
created_at timestamptz = now()
```

- email 与 users 使用相同规范；CHECK attempts >= 0。
- 登录验证码/找回密码未启用，不预先扩成通用认证平台。校验/消耗挑战在同一事务中锁定对应行。
- 量小按批清理过期记录；达到规模再加 expires_at 索引。禁止记录验证码原文。

### 06 signup_email_limits：验证码发送窗口

```text
scope varchar(80) PK
count integer
reset_at timestamptz
last_sent_at timestamptz
```

- CHECK count >= 0；保留当前 scope 编码契约，同一 scope 原子 UPSERT。
- 不为单行键查询再建额外索引；批量清理是否加 reset_at 索引取决于记录数。

## 3. 审计：2 张

### 07 activity_logs：用户操作

```text
id integer PK identity
user_id integer? FK users.id
action varchar(80)
ip_address inet?
created_at timestamptz = now()
```

- timestamp 重命名 created_at，IP 从 varchar 转 inet；历史空字符串先变 NULL，非法 IP 单独处理。
- 索引：(user_id, created_at DESC, id DESC)，对应用户最近操作及稳定分页。
- 追加写；尚无需要时不加大 JSON 请求载荷。

### 08 admin_audit_logs：管理员审计

```text
id integer PK identity
admin_user_id integer FK users.id
action varchar(120)
target_type varchar(80)
target_id integer?
metadata jsonb = '{}'
created_at timestamptz = now()
```

- 索引：(created_at DESC,id DESC)，(target_type,target_id,created_at DESC,id DESC)。
- target 是多种业务实体，不伪造一个通用外键；保持管理员真实 FK，metadata 写清变更前后与原因。
- 原 metadata text 先检查是否合法 JSON，不合法历史保存为 {legacy_text: ...}。

## 4. 模型配置与执行：4 张

本节实际为 2 张配置/调度表、1 张版本表、1 张调用表。两种模型调用有不同父实体，保持专用外键，不合并为 parent_type+parent_id。

### 09 llm_model_configs：可变配置身份与可用性

```text
id integer PK identity
name varchar(120)
current_version_id integer?
quick_enabled boolean = true
deep_enabled boolean = true
is_default boolean = false
is_active boolean = true
unavailable_reason varchar(40)?
unavailable_at timestamptz?
availability_checked_at timestamptz?
retired_at timestamptz?
created_at timestamptz = now()
updated_at timestamptz = now()
```

- current_version_id 在建配置的事务中赋值，提交时必须非空；使用 DEFERRABLE 约束触发器校验，允许先插身份再插版本，避免循环插入难题。
- (current_version_id,id) 复合 FK 指向版本表 (id,config_id)，保证当前版本属于该配置。
- UNIQUE 常量表达式 ((1)) WHERE is_default AND retired_at IS NULL，限制最多一个未退役默认配置；默认配置是否 active 由同一事务维护。它不保证始终有一个默认值。
- 配置表很小，不堆叠 is_active 等单列布尔索引。可用性检查通过配置身份，不能只看不可变版本。

### 10 llm_model_config_versions：不可变执行版本（新增）

```text
id integer PK identity
config_id integer FK llm_model_configs.id
version integer
provider varchar(80)
base_url text
model_name varchar(160)
model_options jsonb = '{}'
encrypted_api_key text
input_price numeric(15,6)?
cache_price numeric(15,6)?
output_price numeric(15,6)?
price_currency varchar(3) = 'CNY'
price_unit_tokens integer = 1000000
provenance text = 'configured'
created_at timestamptz = now()
```

- UNIQUE(config_id,version)，UNIQUE(id,config_id) 支持复合 FK。CHECK version>0，price_unit_tokens>0，非空价格>=0；model_options 为 object。
- provenance IN ('configured','historical_snapshot')，区分当前配置版本与可靠历史快照。缺失快照的旧任务不创建虚假版本。
- 配置行 UPDATE 锁串行分配 version+1，禁止并发 MAX(version)+1。执行参数、密钥、价格变化创建新版本；显示名称、可用状态不创建执行版本。
- 数据库触发器/写权限禁止修改执行字段和删除已引用版本；不通过普通接口泄露 encrypted_api_key。
- 撤销密钥与停用配置独立于“版本不可变”：需要明确阻止旧任务继续调用时，按配置身份/撤销策略拒绝执行。换密钥不应悄悄改写旧版本。
- 不增加 JSON 参数 GIN 索引；当前没有按模型参数检索的查询。

### 11 analysis_worker_settings：任务并发参数

```text
key varchar(50) PK
system_concurrency integer = 200
user_concurrency integer = 5
updated_at timestamptz = now()
```

- 固定 key='analysis_worker'，沿用当前 ANALYSIS_WORKER_SETTINGS_KEY；CHECK system_concurrency>0、user_concurrency>=0。0 表示不限制用户并发，Worker领取逻辑已有此分支，但配置 normalizePositiveInteger 当前不接受0，实施时需同步修改配置校验和管理表单，否则保持最低1。
- 不改成任意 key/value 配置表，保留类型和约束。

### 12 analysis_model_calls：分析模型调用明细

```text
id integer PK identity
job_id integer FK analysis_jobs.id
call_id varchar(100)
model_version_id integer? FK llm_model_config_versions.id
agent varchar(160)
role text
provider varchar(80)?
model text
status text
started_at timestamptz
ended_at timestamptz?
input_tokens bigint?
output_tokens bigint?
total_tokens bigint?
cached_input_tokens bigint?
usage_available boolean = false
raw_usage jsonb?
pricing_snapshot jsonb?
estimated_cost numeric(24,12)?
cost_currency varchar(3)?
cost_complete boolean = false
is_retry boolean = false
request_kind text = 'standard'
```

- UNIQUE(job_id,call_id) 仍负责幂等同步，不能被按时间索引替代。
- role IN ('quick','deep','legacy')；status IN ('running','complete','failed','interrupted')；request_kind 保留现有 standard/structured/free-text，并在迁移时核对全部上报值再约束。
- Token 非空时>=0、estimated_cost>=0、ended_at>=started_at。未知 Token 保持 NULL，不能把 0 与未知混淆；total_tokens 保留供应商口径，不强制等于 input+output。
- model_version_id 对可靠新数据必填；旧记录可空。provider/model 为实际执行观察值，不能删掉后仅关联当前配置。
- pricing_snapshot 保存本次使用的币种、计价单位、价格和计算版本；cost_complete 为 true 必须有金额、币种及足够定价证据。
- 现有唯一索引支持 job_id 查询；暂不另建 (job_id) 单列索引。若调用分页正式启用，新增 (job_id,started_at,id) 并统一稳定排序。

## 5. 分析任务与结果：4 张

### 13 analysis_jobs：任务输入、状态和列表汇总

```text
id integer PK identity
run_id varchar(120) UNIQUE
user_id integer FK users.id
instrument_id integer? FK instruments.id
ticker varchar(40)
trade_date date
realtime_data boolean = false
language varchar(40) = 'Chinese'
depth smallint
analysts jsonb
quick_model_version_id integer? FK llm_model_config_versions.id
deep_model_version_id integer? FK llm_model_config_versions.id
quick_model varchar(160)?
deep_model varchar(160)?
configuration_state text
charged_credits integer?
input_tokens bigint = 0
output_tokens bigint = 0
total_tokens bigint = 0
token_usage_complete boolean = false
status text = 'queued'
external_status text?
external_pid integer?
worker_owner uuid?
worker_lease_until timestamptz?
error_message text?
started_at timestamptz?
completed_at timestamptz?
hidden_at timestamptz?
created_at timestamptz = now()
updated_at timestamptz = now()
```

- configuration_state IN ('versioned','legacy_unknown')；versioned 要求两个版本均非空，legacy_unknown 要求均为空。不允许半套配置；单角色可恢复证据先保存于迁移归档，不伪造另一角色。
- 新任务只允许 versioned，且 charged_credits 必填并>=0；analysts 是字符串数组且合法 agent 名由应用验证。旧任务实际费用从可靠扣费流水提取，无法确定时 charged_credits=NULL 表示未知，不能填当前价格。数据库 CHECK 允许未知历史费用；新建接口/受控 INSERT 触发器拒绝新任务缺失费用。配置证据与费用证据独立，不因为费用未知就丢弃可靠配置版本。
- status IN ('queued','running','complete','failed')，兼容当前取消以 failed+外部原因表示。若新增独立 cancelled，需一并修改状态机和 API。
- ticker 是提交时标识快照，instrument_id 是身份关联；历史允许未知，新任务通过股票目录创建/关联，不能仅凭相同 symbol 跨交易所合并。
- 不保留 provider/base_url/model_config_id/quick_model_config_id/deep_model_config_id/quick_config_snapshot/deep_config_snapshot。保留 quick_model/deep_model 两个小型名称快照，支持高频列表和无版本旧任务的历史展示；它们不是执行权威。新任务由版本内容生成这些值，换模时同事务更新，Worker只使用版本执行。
- 汇总 Token 保留为列表缓存，由明细同步事务维护；完整性标志保留。charged_credits 保存实际扣费，重试是否再次收费由流水操作键明确。
- UNIQUE(id,user_id) 是归属外键目标，不能作为“与主键重复”删掉。
- 用户可见列表：(user_id,id DESC) WHERE hidden_at IS NULL；已删除列表不默认再加一套索引，实际增长后评估。
- 用户股票历史：(user_id,instrument_id,trade_date DESC,id DESC) WHERE hidden_at IS NULL。
- 管理状态分页：(status,id DESC)，全状态按 id 用主键倒序。
- 队列：(created_at,id) WHERE status='queued'；运行恢复：(worker_lease_until,id) WHERE status='running'。这是拆分新领取/恢复查询后的设计，不能直接套到当前含 OR/复杂排序的单个领取 SQL。
- 不把 updated_at 或 Token 放进索引；不把全部列表列 INCLUDE 进覆盖索引。

### 14 analysis_reports：每种报告的当前内容

```text
id integer PK identity
job_id integer FK analysis_jobs.id
user_id integer FK users.id
report_key varchar(80)
title varchar(160)
relative_path text?
content text
created_at timestamptz = now()
updated_at timestamptz = now()
```

- 维持 UNIQUE(job_id,report_key)、INDEX(job_id,user_id)、复合 FK(job_id,user_id)→analysis_jobs(id,user_id)。
- relative_path 保留 Runner 文件关联用途，不把它当下载授权路径。报告仍是一种类型一份当前版本，不预建 report_versions。
- 正文保持 text；列表只取 id/key/title/updated_at，点开才取 content。当前最多 10 份/任务，小范围排序无需再加排序索引。
- 当前实测查单份约 0.019ms，元信息列表约 0.032ms，仅为本地缓存计划耗时。无需新增 job_id 单列索引、content 索引或正文拆表。
- 若后续 Worker 同步反复读大正文成为瓶颈，可增加 content_hash bytea 并统一所有写入口维护；当前不把未验证收益的摘要列列为必需字段。

### 15 analysis_decisions：报告提取后的结构化结论

```text
id integer PK identity
job_id integer UNIQUE FK analysis_jobs.id
action text?
summary text?
extraction_status text
extraction_version integer = 1
extracted_at timestamptz = now()
updated_at timestamptz = now()
```

- action IN ('buy','sell','hold')，extraction_status IN ('pending','succeeded','unrecognized','failed')，extraction_version>0。
- succeeded 必须 action 非空；未识别时允许 action=NULL。独立保留它可避免列表/行情页读取报告正文再解析。
- job_id UNIQUE 已覆盖查结论；暂不为 action 小枚举单独建索引。

### 16 analysis_job_resumptions：换模历史

```text
id integer PK identity
job_id integer
user_id integer FK users.id
previous_quick_version_id integer? FK llm_model_config_versions.id
previous_deep_version_id integer? FK llm_model_config_versions.id
next_quick_version_id integer? FK llm_model_config_versions.id
next_deep_version_id integer? FK llm_model_config_versions.id
previous_quick_model varchar(160)?
previous_deep_model varchar(160)?
next_quick_model varchar(160)?
next_deep_model varchar(160)?
configuration_state text
initiator text
created_at timestamptz = now()
```

- 复合 FK(job_id,user_id)→analysis_jobs(id,user_id)；索引(job_id,id DESC)。查询最新换模按 id，展示时间使用 created_at。
- initiator IN ('user','automatic','admin','legacy_unknown')。configuration_state 与任务同值域，但表示此事件引用的恢复程度；versioned 要求 next 两个版本非空，previous 可因旧任务为空。
- 新记录必须有 next 两版本及模型名称快照，历史已有可靠 next 快照的迁为版本；没有证据保持 legacy_unknown。四个短名称保留供审计展示，四份完整配置快照迁移后归档再移除。

## 6. 股票与行情：6 张

### 17 instruments：全局股票身份

```text
id integer PK identity
symbol varchar(40)
exchange varchar(40)
name varchar(160)?
currency varchar(12)?
timezone varchar(80)?
status text = 'unresolved'
verified_at timestamptz?
sync_enabled boolean = true
```

- UNIQUE(exchange,symbol)；status IN ('verified','unresolved','inactive')。
- verified 要求币种、时区、验证时间且 exchange!='UNRESOLVED'；供应商 symbol 通过 instrument_sources 关联。
- 未解析占位身份与已验证身份不能按 ticker 盲合并，确认冲突及所有子引用后再合并。
- 目前小目录的 ILIKE 搜索可扫描；大规模确有模糊查询瓶颈再设计 pg_trgm，不默认建立多个文本索引。

### 18 instrument_sources：供应商身份映射

```text
id integer PK identity
instrument_id integer FK instruments.id
vendor varchar(40)
vendor_symbol varchar(40)
status text = 'unresolved'
verified_at timestamptz?
```

- UNIQUE(vendor,vendor_symbol)；INDEX(instrument_id)。status 使用与 instruments 一致的已确认值域。
- 可有多个 vendor_symbol 映射同一股票；不未经确认新增 UNIQUE(instrument_id,vendor)。

### 19 price_snapshots：报价历史与成交证据

```text
id integer PK identity
instrument_id integer FK instruments.id
price numeric(24,8)
currency varchar(12)
quoted_at timestamptz
fetched_at timestamptz = now()
source varchar(40)
price_type varchar(40)
session varchar(20)
```

- UNIQUE(instrument_id,source,quoted_at,price_type)；INDEX(instrument_id,quoted_at DESC,id DESC)。
- CHECK price>0 且小于现有限值，price_type='regular_unadjusted'、session='regular'，保持当前可成交口径。
- 已被成交引用的报价不可覆盖/删除。同一身份报价若内容变化，保持证据不可变，另行定义修订身份或保存供应商修订，不能静默 upsert 改写已成交价格。
- INDEX 最新报价采用 quoted_at,id 稳定排序；不要把“最近抓取”当成“最近市场报价”。

### 20 daily_prices：日线 OHLCV

```text
id integer PK identity
instrument_id integer FK instruments.id
trading_date date
open numeric(24,8)
high numeric(24,8)
low numeric(24,8)
close numeric(24,8)
volume bigint
source varchar(40)
adjusted boolean = false
fetched_at timestamptz = now()
```

- 目标唯一索引(instrument_id,source,adjusted,trading_date DESC)，与当前按股票+来源+复权取日期区间的查询一致；替换现有顺序，不重复增加同列唯一性索引。
- CHECK low>0、high>=low、open/close 在 low..high 之间、volume>=0，保留现有高价上限。
- 当前无只按日期扫描全市场的主入口，不新增 trading_date 单列索引。继续一张表，不预先按年分区。

### 21 market_sync_state：行情调度与租约

```text
id integer PK identity
instrument_id integer FK instruments.id
category text
last_success_at timestamptz?
next_run_at timestamptz = now()
attempts integer = 0
error_summary varchar(160)?
lease_until timestamptz?
owner uuid?
```

- UNIQUE(instrument_id,category)，INDEX(next_run_at,instrument_id)；category IN ('identity','quote','daily')，attempts>=0。
- owner/lease_until 同时空或同时非空；领取股票时保留当前跨 category 防重复抓取约束，不只按某一个 category 独立领取。
- 未加 id 外的第二个自然主键，维持现有更新与恢复入口。

### 22 market_sync_runs：一次行情同步批次

```text
id integer PK identity
owner uuid
started_at timestamptz = now()
ended_at timestamptz?
claimed integer = 0
succeeded integer = 0
failed integer = 0
error_summary varchar(160)?
```

- CHECK 计数非负，ended_at>=started_at。当前 claimed 是股票数而 succeeded/failed 按同步 category 累加，不能加 succeeded+failed=claimed 约束。
- 保留字段兼容，但文档/API 明确其单位；若统一统计口径再迁移重命名，不用历史数值臆测换算。
- 没有常用批次检索时只保留 PK；日志达到规模后按实际保留周期批清理，需要时添加 started_at 索引。

## 7. 自选、模拟账户与交易：8 张

### 23 watchlist_items：用户关注的股票

```text
id integer PK identity
user_id integer FK users.id
instrument_id integer FK instruments.id
is_active boolean = true
created_at timestamptz = now()
updated_at timestamptz = now()
```

- UNIQUE(user_id,instrument_id)，UNIQUE(id,user_id) 支持归属 FK；活动列表索引(user_id,created_at DESC,id DESC) WHERE is_active。
- 移除 ticker/market/name 当前展示副本，从 instruments/供应商映射取。新接口允许 instrument_id，解决同 ticker 跨市场歧义。
- NOT NULL instrument_id 是清理完成后的目标：历史 NULL 先保留，建立可靠目录/占位身份并验证归属后收紧，不能按 symbol 无条件配对。

### 24 paper_portfolios：模拟账户余额

```text
id integer PK identity
user_id integer FK users.id
name varchar(120) = 'Paper Portfolio'
initial_cash_cents bigint
cash_cents bigint
currency varchar(12) = 'USD'
status text = 'active'
auto_trade_enabled boolean = false
created_at timestamptz = now()
updated_at timestamptz = now()
```

- UNIQUE(id,user_id)；INDEX(user_id,status,created_at DESC,id DESC) 支持取用户最新活动账户。
- CHECK initial_cash_cents>=0、cash_cents>=0，金额安全整数范围；status IN ('active','archived')，部署前核对其他旧值。
- 暂不限制每人只能一个 active 账户，当前代码选择最近一个并不能证明业务禁止多个。
- 账户 currency 创建后不可随意改变。成交先锁账户，再按固定顺序锁决策/持仓，避免透支、重复卖出和死锁。

### 25 paper_positions：账户当前持仓缓存

```text
id integer PK identity
portfolio_id integer
user_id integer FK users.id
instrument_id integer FK instruments.id
quantity integer = 0
avg_cost_cents bigint = 0
last_price_cents bigint = 0
realized_pnl_cents bigint = 0
created_at timestamptz = now()
updated_at timestamptz = now()
```

- UNIQUE(portfolio_id,instrument_id)，UNIQUE(id,portfolio_id,user_id) 支持成交归属。
- 复合 FK(portfolio_id,user_id)→paper_portfolios(id,user_id)；该唯一索引前缀支持账户持仓查询，不另加 portfolio_id 单列索引。
- 保留(user_id)引用端索引/跨账户归属查询支持；不为每次成交变动的 updated_at 增加排序索引，小账户持仓内存排序即可。
- CHECK quantity>=0，avg_cost/last_price>=0，各分金额安全范围。realized_pnl 可负。
- last_price 是最近成交缓存，不是实时行情；页面市值取共享行情并显示时效。ticker 从 instruments 读取。

### 26 paper_trades：不可变成交事实

```text
id integer PK identity
portfolio_id integer
user_id integer FK users.id
position_id integer?
instrument_id integer FK instruments.id
ticker varchar(40)
decision_id integer? FK paper_trade_decisions.id
price_snapshot_id integer? FK price_snapshots.id
execution_price numeric(24,8)?
side text
quantity integer
price_cents bigint
gross_amount_cents bigint
fee_cents bigint = 0
realized_pnl_cents bigint = 0
note text?
created_at timestamptz = now()
```

- UNIQUE(decision_id) 非空，保持每个决策最多成交一次；手工交易没有 decision_id。
- 复合 FK(portfolio_id,user_id)→账户、(position_id,portfolio_id,user_id)→持仓、(decision_id,portfolio_id,user_id)→决策，沿用已有归属边界。
- INDEX(portfolio_id,created_at DESC,id DESC)，INDEX(user_id,created_at DESC,id DESC)。position_id 引用端索引仅在持仓删除检查/回放查询确有需求时增加，持仓默认不删除。
- CHECK side IN ('buy','sell')，quantity>0、price_cents>0、fee>=0；gross=quantity*price_cents，使用 numeric 中间计算避免 bigint 乘法先溢出；金额最终仍须在安全范围。
- execution_price 保存来源精度的报价证据，price_cents 是按既定规则舍入的实际结算单价；两者语义不同，不能简单删一列。
- 成交事务校验 position/decision/quote 的 instrument_id 与成交股票相同；报价和股票身份已引用后不可任意重绑定。必要时在生产 SQL 中补复合 instrument 外键，但先比较新增宽唯一索引成本。
- ticker 保存成交时标识快照，不与当前持仓展示字段等同。

### 27 paper_trade_requests：手工交易幂等结果

```text
id integer PK identity
user_id integer FK users.id
portfolio_id integer
key uuid
request_hash bytea
request jsonb
result jsonb
created_at timestamptz = now()
```

- UNIQUE(user_id,portfolio_id,key)；复合 FK(portfolio_id,user_id)→账户；request/result 为 object。
- request 先按规范化字段产生确定性序列化再算 SHA-256，hash 长度32；相同键也比较规范化请求，禁止直接依赖原始 JSON 字符串键顺序。
- 在账户锁内检查请求，在成交事务内写结果；不能提前存 success。若允许未提供幂等键，明确仅带键请求享有重放保证。
- 幂等记录不可早于业务承诺的重放窗口清理，避免旧请求重放再次成交。

### 28 paper_analysis_runs：模拟账户分析及交易模型处理

```text
id integer PK identity
portfolio_id integer
user_id integer FK users.id
watchlist_item_id integer?
analysis_job_id integer
trader_model_version_id integer? FK llm_model_config_versions.id
context jsonb?
processing_state text = 'queued'
worker_owner uuid?
worker_lease_until timestamptz?
model_submitted_at timestamptz?
model_call_id varchar(100)?
created_at timestamptz = now()
```

- UNIQUE(analysis_job_id)，UNIQUE(id,portfolio_id,user_id,analysis_job_id)；复合 FK 账户归属、分析任务归属、自选项归属全部保留。
- INDEX(portfolio_id,created_at DESC,id DESC)；保留(user_id,created_at DESC,id DESC) 跨账户归属/历史访问。
- processing_state IN ('queued','claimed','submitted','complete','failed','unknown')。
- 队列候选索引(created_at,id) WHERE processing_state='queued'；恢复/过期索引(processing_state,worker_lease_until,id) WHERE processing_state IN ('claimed','submitted')。需配合分支领取 SQL 评估，不默认使当前 OR 查询完全消除排序。
- trader_model_version_id 固定后续“交易建议模型”，与研究任务 Quick/Deep 配置分开；新运行创建或明确领取时固定，之后不可在恢复时悄悄切换。旧数据可空。
- context 保存生成当时账户/持仓上下文证据，JSONB 对象；历史纯文本不能直接强转，需兼容 {legacy_text:...}。
- ticker 从 analysis_job 读取，不再重复保存。提交过的模型调用中断后保持 unknown，不因租约超时自动再调用造成重复计费。

### 29 paper_model_calls：交易建议模型调用

```text
id integer PK identity
paper_run_id integer FK paper_analysis_runs.id
call_id varchar(100)
model_version_id integer? FK llm_model_config_versions.id
provider varchar(80)
model text
status text
started_at timestamptz = now()
ended_at timestamptz?
input_tokens bigint?
output_tokens bigint?
total_tokens bigint?
cached_input_tokens bigint?
usage_available boolean = false
raw_usage jsonb?
pricing_snapshot jsonb?
estimated_cost numeric(24,12)?
cost_currency varchar(3)?
cost_complete boolean = false
is_retry boolean = false
```

- UNIQUE(paper_run_id,call_id)，其前缀满足按运行查询。created_at 重命名 started_at，明确它是提交时间而非业务记录更新时间。
- 使用与 analysis_model_calls 相同的 Token/金额/时间约束；保留独立表与强类型父外键，应用层复用计价/序列化代码。
- 移除旧 model_config_id，改版本引用；实际 provider/model 仍保留。历史未知不能填假值或填0。

### 30 paper_trade_decisions：建议与执行状态

```text
id integer PK identity
portfolio_id integer
user_id integer FK users.id
paper_analysis_run_id integer
analysis_job_id integer
action text
confidence_bps integer = 0
target_weight_bps integer = 0
quantity integer = 0
price_cents bigint = 0
reason text?
risk_notes text?
raw_response text?
status text = 'proposed'
error_message text?
created_at timestamptz = now()
executed_at timestamptz?
```

- UNIQUE(paper_analysis_run_id)，UNIQUE(id,portfolio_id,user_id)；保留账户归属与 (paper_analysis_run_id,portfolio_id,user_id,analysis_job_id)→运行复合外键。
- INDEX(portfolio_id,created_at DESC,id DESC)，INDEX(user_id,created_at DESC,id DESC)。无全局状态队列查询时不默认保留 status 单列索引。
- CHECK action IN ('buy','sell','hold')，status IN ('proposed','executed','skipped','failed')，confidence/target_weight 在0..10000，quantity>=0、price_cents>=0且安全。
- ticker 从 job 取。quantity/price 表示建议或执行结果，API 明确当前口径；如未来必须同时保留建议数量和实际数量再拆两列，当前成交事实在 paper_trades。
- executed 必须有 executed_at；实际买卖成交与决策状态同事务写入，UNIQUE(decision_id) 为最终防重保障。

## 8. 性能策略与实际查询契约

| 页面/后台动作 | 查询范围与访问路径 |
| --- | --- |
| 登录/鉴权 | users.email UNIQUE 或 users.id PK；不加载账务、模型凭据 |
| 分析历史 | user_id + hidden_at NULL + id 游标，单页20条；直接取短模型名快照，不读完整配置 |
| 管理任务 | 先筛选/分页任务，再对本页汇总成本；当前 lateral 聚合需确认计划确实只访问必要任务 |
| 单任务报告 | job_id + report_key UNIQUE；同时核对任务用户和 hidden_at |
| 任务详情轮询 | 元信息与必要调用状态；不重复返回全部报告正文；调用数增大再做游标/增量同步 |
| 模型用量同步 | UNIQUE(job_id,call_id) 幂等，只有调用变化才更新；汇总在同事务维护 |
| 自选行情 | 用户自选股 IDs + 全局行情批量读取，禁止每只股票各请求数据库 |
| 日线 | instrument + source + adjusted + date 范围，固定条数上限 |
| 模拟成交 | 用户验证→账户锁→决策锁→持仓固定顺序锁；资金/持仓/成交/幂等结果同事务 |
| 分析领取 | queued 和 running恢复分支查询，FOR UPDATE SKIP LOCKED，领取事务短暂持锁 |

注意：SKIP LOCKED 只解决已锁任务的竞争，不自动保证全局/用户并发上限。现有 advisory lock 仍需保留或用经验证的配额计数器替代，不能在加索引时顺手删除。

心跳字段 worker_lease_until 在恢复索引中，更新有索引维护成本；不再随意为心跳增加多套索引。若高并发压测证明它导致严重写放大，再考虑单独租约表/降低心跳频率；当前不拆第31张运行状态表。

## 9. 删除、保留与历史兼容

| 旧位置 | 目标处理 |
| --- | --- |
| users.analysis_credits 和 Stripe/套餐列 | 移 billing_accounts，账务入口全部切换后再删 |
| analysis_jobs 旧配置ID、provider/base_url、两份快照 | 迁可靠版本后退出，历史无证据不强行回填 |
| analysis_jobs.quick_model/deep_model | 保留短名称快照支持列表与旧任务；执行以版本为准 |
| analysis_jobs.trade_date varchar | date，API仍序列化 YYYY-MM-DD；Python契约一起修改 |
| analysis_jobs.analysts text | 验证是数组后转 jsonb |
| 两类调用 model_config_id | 改 model_version_id，保留实际 provider/model/计费证据 |
| 换模审计模型名和四份快照 | 保留短名称；可靠信息转版本引用，四份完整快照迁移后归档 |
| watchlist ticker/market/name、positions ticker | 改 instrument 引用，先解决身份歧义和NULL再删 |
| paper_runs / paper_decisions ticker | 从已有 job 取，保留成交 ticker 快照 |
| activity_logs.timestamp / paper_model_calls.created_at | 分别统一为 created_at / started_at |
| 模型 raw_usage/pricing_snapshot、审计metadata、上下文 | 转 jsonb，非法历史显式封装，不静默丢弃 |

**目标结构与历史过渡结构必须区分**：目标30表适用于清理完成的新结构；旧缺失配置/身份/扣费证据在迁移阶段允许兼容列及离线加密归档。不得为达成30表或NOT NULL而删历史数据。若产品要求数据库内完整查询所有无法解析的历史原文，则应增加专门 legacy_import_records 表（31表）或保留旧归档表，而不是把它们伪装成可靠新数据。

## 10. 分阶段实施与验收

1. 先修普通/模拟任务配置写入一致性，统一身份解析和参数校验；新增列暂允许旧数据缺失。
2. 新增 billing_accounts 和配置版本表；新用户/扣费/充值/推荐/管理员调整/换模/Worker入口一并双写；账本基线切换禁止旧写实例继续修改 users余额。
3. 迁移可靠历史快照与股票身份，记录不可恢复项；核对新旧查询结果及计费总额。旧配置不完整时保留现有拒绝不安全恢复行为。
4. 将任务列表/详情/调用、支付、模拟交易和Python契约全部切读新结构，移除双写前确认全部运行实例已升级。
5. 按新SQL替换索引，使用接近预期规模的数据验证吞吐、p95、扫描行数、WAL量与索引大小；更新 schema、迁移快照及ER图。不可只在百行本地数据上声称提速百分比。
6. 约束验证通过、历史归档可恢复后，再单独发布删列迁移。DDL锁/大表索引应在实施时选择并发创建或维护窗口，不能直接把所有DDL塞入一个线上大事务。

必须覆盖：新空库初始化与旧库升级、邮箱大小写冲突、双账户邀请死锁、并发扣费不透支、重复Stripe回调只加一次、事务失败不留半笔账、配置排队后变化、Quick/Deep不同供应商、自动换模与停用检查、Worker重启/租约失效、已提交交易模型不重复计费、跨用户/跨账户外键拒绝、相同幂等键不同请求拒绝、报价与币种验证、金额精确计算、未知用量不冒充0、分页稳定性和报告按需读取。

## 11. 暂不增加的表

不新增 report_contents/report_versions、通用entity表、通用task表、独立Token汇总表、独立租约表、每个analyst一张表、每个模型一张表、每年一张行情表、无实际需求的订阅/订单/套餐全家桶。需要可重放全套执行尝试时，再引入 analysis_attempts，并让调用/换模绑定具体尝试，不能用目前的换模审计冒充全部执行历史。

## 12. PostgreSQL技术依据

- 联合索引：https://www.postgresql.org/docs/16/indexes-multicolumn.html
- 约束与外键：https://www.postgresql.org/docs/16/ddl-constraints.html
- 时间类型：https://www.postgresql.org/docs/16/datatype-datetime.html
- 大字段TOAST：https://www.postgresql.org/docs/16/storage-toast.html
- HOT与索引更新成本：https://www.postgresql.org/docs/16/storage-hot.html
- 队列锁：https://www.postgresql.org/docs/16/sql-select.html
