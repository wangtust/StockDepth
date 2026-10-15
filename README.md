# StockDepth

StockDepth 是股票分析与模拟交易平台，支持多智能体分析、分析任务与报告管理、模拟交易，以及管理员模型配置、用户管理和订阅支付。任务列表和详情显示运行耗时及输入、输出、总 token，详情可查看每个 agent 的模型调用耗时和用量。

## 项目架构

项目由五个独立服务组成，统一读取根目录 `.env`：

| 服务 | 目录 | 职责 |
| --- | --- | --- |
| Web | `apps/web` | Next.js 网站，负责登录、管理页面、任务与报告展示、支付 |
| 分析 API | `apps/api` | Python 多智能体分析，负责模型调用、行情与新闻数据、报告和检查点 |
| 分析 worker | `apps/workers` | 从数据库领取分析任务，调用 API 并同步结果 |
| 模拟交易 worker | `apps/workers` | 处理模拟交易任务与决策 |
| 行情 worker | `apps/workers` | 共享股票目录的身份、报价和日线同步（显式启动） |

PostgreSQL 保存用户、模型、任务、报告与模拟交易数据，并作为 worker 的持久任务队列。分析文件和检查点默认保存在 `~/.stockdepth`。服务启停由 `bin/stockdepth` 统一管理，详细架构见 [架构说明](docs/architecture.md)。

## 环境配置

以下步骤默认已准备好 PostgreSQL 数据库和数据库用户，且连接用户具有创建和修改项目表结构的权限。

### 1. 创建运行环境并安装依赖

```bash
conda create -n stockdepth -c conda-forge python=3.11 nodejs=22 -y
conda activate stockdepth
npm install -g pnpm@12.11.2 tsx@4.23.15

cd ./StockDepth
pnpm install --frozen-lockfile
python -m pip install -e apps/api
```

首次运行或更新网页代码后，先执行 `./bin/stockdepth build`，再执行
`./bin/stockdepth start`。网页默认使用 `next build` / `next start` 的生产模式。
只更新网页时执行 `./bin/stockdepth stop web`、`./bin/stockdepth build`、
`./bin/stockdepth start web`；构建失败时不会自动退回开发模式。
开发网页可使用 `pnpm dev`。应用依赖固定版本，安装时使用仓库根目录锁文件。
连接池默认最多 5 个连接，并为 Drizzle 的参数查询启用预编译，减少重复 Describe
往返。若数据库连接代理不支持预编译语句，设置 `STOCKDEPTH_DB_PREPARE=false`。

分析任务并发仅使用管理员页面设置的系统并发和每人并发，30 秒内自动刷新。
不再读取本机或供应商任务并发环境变量，模型 request_concurrency 不影响任务领取。可用内存低于 256 MB 时
暂停领取新任务，继续监测已有任务和恢复中的任务。`var/analysis.log` 每 30 秒
记录活动任务、队列长度、最长排队时间、Worker/分析进程 RSS 和可用内存。
供应商调用在本机独立 Python runner 之间共享限流文件，默认每分钟 60 次初始调用；
可用 `STOCKDEPTH_PROVIDER_<供应商大写且连字符替换为下划线>_RPM` 覆盖。
SDK 内部重试继续使用其退避策略，可能增加实际 HTTP 请求数；兼容网关保留最多
一次 SDK 重试，其余默认最多两次。多个主机不会共享这一限流额度。
这些保护值不是已验证的真实模型容量，调整前应先测内存和供应商配额。

只读性能复测：`node scripts/diagnostics/measure-stage.cjs final`。
数据库统计：`node scripts/diagnostics/database-stats.cjs`；未安装
`pg_stat_statements` 时明确报告不可用，不自动修改远程数据库的全局设置。
`node scripts/diagnostics/worker-capacity.cjs` 需要创建数据库权限，自动创建并
清理独立测试库，验证完整迁移和 1/2/4 并发的队列及报告存储，不调用收费模型。

如果环境和依赖已安装，可跳过这一步。

### 2. 配置根目录 `.env`

首次配置时复制模板；已有 `.env` 不要覆盖：

```bash
cp .env.example .env
chmod 600 .env
```

在激活的 Conda 环境中执行 `echo "$CONDA_PREFIX/bin"`，将输出的绝对路径填入 `STOCKDEPTH_RUNTIME_BIN`。启动脚本直接使用该目录中的 Python、Node.js、pnpm 和 tsx，后续启停无需手动激活环境。

按实际环境修改以下配置：

```dotenv
STOCKDEPTH_RUNTIME_BIN=/home/ubuntu/miniforge3/envs/stockdepth/bin
POSTGRES_URL=postgresql://user:password@127.0.0.1:5432/database_name
BASE_URL=http://localhost:3000
AUTH_SECRET=replace-with-random-secret

# 首次创建的网页登录管理员
STOCKDEPTH_ADMIN_EMAIL=admin@example.com
STOCKDEPTH_ADMIN_PASSWORD=replace-with-your-admin-password

# 分析 API 地址及服务之间的认证凭据
STOCKDEPTH_API_URL=http://127.0.0.1:8008
STOCKDEPTH_API_USERNAME=admin
STOCKDEPTH_API_PASSWORD=replace-with-your-internal-api-password
STOCKDEPTH_WEB_HOST=127.0.0.1
STOCKDEPTH_WEB_PORT=8008
STOCKDEPTH_WEB_USERNAME=admin
STOCKDEPTH_WEB_PASSWORD=replace-with-your-internal-api-password
```

- `POSTGRES_URL` 指向已有数据库；密码中的 URL 特殊字符需要进行 URL 编码。
- `BASE_URL` 使用实际网站地址，公网访问时填写 `http://服务器公网IP:3000` 或对应域名。
- `AUTH_SECRET` 可通过 `openssl rand -base64 32` 生成。
- `STOCKDEPTH_API_USERNAME / PASSWORD` 与 `STOCKDEPTH_WEB_USERNAME / PASSWORD` 必须分别一致；它们用于内部 API 认证，不是网页登录账户。
- 初始管理员密码须为 8–100 个字符，UTF-8 长度不超过 72 字节。

其他配置可保留 `.env.example` 中的默认值。无需支付时，Stripe 配置可保留模板占位值。模型供应商、模型名称、服务地址和 API Key 在登录后的模型管理页面配置，保存在数据库中。管理员可为每个模型配置输入、缓存命中、输出价格（人民币元 / 百万 tokens）。三项全部填写或全部留空，0 表示免费；管理员任务列表和详情可查看估算费用，普通用户页面不显示价格或费用。调用记录保存当时的价格，后续改价不影响历史；缺少缓存用量时显示普通输入价计算的上限估算，缺少价格或 token 时费用未知。

## 启动流程

### 1. 启动服务

在项目根目录执行：

```bash
./bin/stockdepth build
./bin/stockdepth start api web analysis paper
./bin/stockdepth status api web analysis paper
```

启动命令会先连接数据库、自动执行迁移并检查项目表，然后初始化管理员并启动服务。初始化失败时会停止启动；重复执行会跳过已运行的服务，不会清空数据。

当数据库中没有未删除的管理员时，启动脚本根据 `STOCKDEPTH_ADMIN_EMAIL` 和 `STOCKDEPTH_ADMIN_PASSWORD` 创建 `super_admin`。已有管理员时保留原账户和密码，修改 `.env` 不会重置密码。两项均未配置时跳过创建；仅配置一项、配置无效或邮箱已被其他账户使用时会停止启动。无需手动执行 `db:seed`。

启动会同时应用任务用量统计的迁移，创建 `analysis_model_calls` 明细表和任务 token 汇总字段；新数据库也会按迁移顺序创建完整结构。耗时从首次开始到结束，继续任务时包含中间等待时间。Token 统计包含已记录的重试请求；供应商没有返回 usage、失败或中断时标记为统计不完整，不估算为零。历史任务无法追溯补齐 token。

### 2. 访问网站并配置模型

本机访问 **http://localhost:3000**，云服务器访问 **http://服务器公网IP:3000**。网站监听 `0.0.0.0:3000`，公网访问需在实例安全组和系统防火墙放行 TCP 3000。分析 API 默认监听 `127.0.0.1:8008`，供内部服务调用。

首次登录使用 `.env` 中配置的管理员邮箱和密码。进入模型管理页面，添加模型供应商、Base URL、Model Name 和 API Key。模型列表可以展开查看和修改配置；通过卡片三点菜单删除时会标记为弃用，保留数据库记录和历史任务，管理员列表和用户可选模型不再显示；新增模型时先进行一次真实调用测试，成功才保存，失败会显示错误；测试可能产生少量 token 费用。启用后，用户创建分析任务时可下拉选择模型，所有分析阶段共用该模型。默认模型用于预选和模拟交易。分析服务需要能访问相应模型服务和行情、新闻数据源。

### 3. 查看日志与启停

```bash
# 查看服务日志
tail -f var/api.log var/web.log var/analysis.log var/paper.log

# 修改 .env 后重启并重新加载配置
./bin/stockdepth restart api web analysis paper

# 停止服务
./bin/stockdepth stop api web analysis paper
```

也可单独操作服务，例如 `./bin/stockdepth restart web`。不指定服务名时默认操作 `api web analysis market`，模拟交易 `paper` 需要显式指定。PostgreSQL 由系统或外部数据库服务管理，启停脚本不管理它。

分析并发配置保存在数据库 `analysis_worker_settings` 中，默认全系统 200 个任务、每用户 5 个任务。管理员可在 `/admin/system` 修改，保存后自动影响后续任务调度；超过限制的任务排队。并发数量不再读取 `.env`。

性能测试与本次优化结果见 [性能诊断](docs/performance-2026-10-12.md)，可运行 `node scripts/diagnostics/latency.cjs` 复测页面、接口和数据库延迟。


## 共享股票目录与行情

`/dashboard/stocks` 提供已登录用户共享的股票搜索、报价来源/时间及有限日线。
关注、组合、交易和报告仍按用户隔离。新增关注、分析或手动模拟交易通过
`ensureInstrument` 幂等建立 unresolved 目录、来源映射和三个同步状态；页面请求
不访问外部行情，不猜交易所。Worker 只领取目录中启用股票的到期状态；删除关注
不会删除目录或停更。管理员可向 `/api/market/instruments/{id}/sync` 发
`PATCH {"enabled": false}` 暂停（true 恢复），普通成员无写权限。原只读 DTO 不变。

旧股票目录初始化是显式一次性、有界操作，在已配置运行环境的 `apps/workers`
目录执行 `tsx src/market-worker.ts --initialize-catalog`，每次最多
`MARKET_CATALOG_INIT_LIMIT` 个（默认100、上限500），可重复直到 initialized=0；
轮询不扫描用户表发现股票。确认迁移和有界源验证后运行
`./bin/stockdepth start market`；默认 start 同时启动 api/web/analysis/market。
`tsx src/market-worker.ts --once` 仅运行一批。每批默认10只、供应商并发2，
生产初次可配置 batch3/concurrency1；启动管理器读取 `.env`，应核对实际设置。

身份每周、日线每天、常规交易时段报价每30分钟；休市延后至下一时段/盘后。
失败保留成功数据并有界退避，租约支持多 Worker 去重、心跳和过期恢复。
日线首次最近一年，随后回补7天；普通未复权价格不会与复权数据混合。
复用已有 Yahoo/yfinance，有限实测 AAPL、600519.SS、0700.HK 的身份，AAPL 日线。
只接受已验证 EQUITY 的指定美股/沪深/港股交易所；其他代码保持 unresolved，
不保证每只股票的数据可用。交易日历是星期/时区/DST/午休的保守近似，
没有完整节假日或提前收盘日历，也没有实时流、FX、全市场抓取。

组合缺失、过期、未验证或异币种报价时显示估值不完整，不按零求和。
手动价格是显式模拟输入；AI 建议价不是成交价，执行在原事务锁内重新读取
同币种、本交易时段内35分钟有效共享快照并保存不可变引用；休市或无有效报价
跳过，原持久幂等重放不重新成交。第五轮 cents 使用 bigint 存储，亚分价格精确四舍五入到分，
原始快照 decimal 单独保存。分析/财报/新闻工具仍保留原路径。

第四轮验收与部署范围见 [结果文档](docs/optimization-results-round4-2026-10-12.md)。
写入回归仅使用 `127.0.0.1:55483` 的 `stockdepth_round4_backend_*` 新隔离库；
禁止给测试传生产 URL。`round4-market.cjs` 覆盖目录/租约/报价/AI，
`round4-backend-regression.cjs` 保留第三轮24项安全断言，迁移/初始化/浏览器
mock/实际私有服务会话另有独立测试。行情快照和批次审计随实际更新增长，
空轮询不写审计；本轮没有历史自动删除策略，长期磁盘容量需运维监测。


## 金额、归属与模型密钥

第五轮将10个资产 cents 字段扩为 PostgreSQL bigint，中间乘加使用 BigInt；
现有 API 仍返回 number，每个金额必须在 ±9007199254740991 分内，超界明确拒绝，
不把 bigint 或静默舍入值发给客户端。数量/ID仍受 int4 限制，Token/费用 numeric 未改。
复合归属外键和安全范围 CHECK 使用 NOT VALID，保护新写入且保留历史异常；
审计不修复、不删除历史，不自动 VALIDATE。原锁顺序、成交报价引用和持久幂等保留。

模型 API Key 使用版本化 AES-256-GCM 信封；管理员只显示配置状态。
新机器须在根 `.env` 安全生成独立 `STOCKDEPTH_MODEL_KEY_ID` 和
`STOCKDEPTH_MODEL_KEYRING`（ID→随机32字节base64url密钥的JSON），权限600，
不打印、提交或覆盖已有材料。缺key时旧明文可兼容读，密文读取/新增保存明确失败；
保存失败发生在原连接探测之前。只读浏览不验证真实key或调用模型。
先让 web/analysis/paper 全部加载兼容reader与环境，确认付费任务安全空闲再重启；
原停用服务保持停用。最后在已有运行环境中显式执行
`scripts/model-key-migrate.ts`：默认dry-run，核实reader后仅该调用设置
`STOCKDEPTH_MODEL_READERS_READY=true` 才可 `--apply`。空key配置保持未设置；
工具仅输出数量、事务原子、可重复。轮换先分发新材料并保留旧key，再切换写ID；
`--rotate --apply` 不删除任何解密材料。数据库备份须另行安全保管对应keyring，
不要导出明文或把key与密文放在同一份数据库dump。

详见 [密钥设计与部署](docs/model-key-security-round5.md) 和
[第五轮验收](docs/optimization-results-round5-2026-10-12.md)。
`round5-backend*` 只接受55483新隔离库；`round5-market.cjs` 为第四轮断言的
bigint适配版，仍使用市场mock限定的 `stockdepth_round4_backend_*` 名称。
加密/轮换/损坏测试仅使用合成key和独立55485库，不访问收费模型。
HTTP与HTTPS的显式模拟交易重试流程保持。生产历史清理默认且强制dry-run：
`scripts/market-retention.ts --apply` 拒绝，保留成交引用、最新报价、活动租约、
全部幂等结果与日线。容量继续需要监测，不能承诺历史存储恒定。


## 股票历史决策图

进入 Stock，选择股票，在详情页的 Historical decisions 查看历史收盘价与
BUY / SELL / HOLD 标记。可筛选日期、决策类型，切换分析日期与报告生成日期，
点击标记或 View 查看原始最终决策报告。仅展示当前用户已完成、未隐藏的分析。

`analysis_decisions` 保存最终报告中明确的评级或交易建议；新报告由分析 worker 自动提取。
Underweight（减持/低配）归为 SELL；Overweight、含条件或冲突的结论不自动转换，保留原评级摘要，
显示 Unrecognized。缺少提取记录显示 Pending，不视为 HOLD。

部署先通过 `./bin/stockdepth start` 或 `restart` 应用数据库迁移，再在仓库根目录执行：

```bash
# 使用 .env 中 STOCKDEPTH_RUNTIME_BIN 所指环境的 tsx
/path/to/runtime/bin/tsx scripts/backfill-analysis-decisions.ts
```

补提取脚本可重复执行，按批次更新历史最终报告，并只为唯一匹配的已验证 Yahoo
身份补齐任务的 instrument_id；无法确认的旧股票代码不自动关联。
图表使用数据库内单一数据源的未复权日线，不触发付费模型请求。
周末报告在有行情的下周一标点，其他缺失交易日不猜测价格；参考收盘价不代表成交价。
同日多份报告全部保留，生成日期按股票市场时区换算，生成时间按浏览器时区显示。
行情同步状态在同页展示；默认启停包含市场 worker；美股报价和日线在纽约时间 16:45 同步，自动适配夏令时。休市日保留上次行情，失败自动重试。

验证脚本：`scripts/tests/analysis-decisions.ts`（提取规则）、
`scripts/tests/analysis-decisions-browser.cjs`（使用构建 CSS 的浏览器交互），以及
`scripts/tests/analysis-decisions-api.cjs`（对本机运行服务和当前数据库的只读权限验证）。
浏览器测试可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已安装的 Chromium。

## 注册邮箱验证

注册前必须向所填邮箱发送验证码，输入正确的 6 位验证码后才能创建账户。
现有账户登录流程不变。根目录 `.env` 配置：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
EMAIL_SENDER=your-address@qq.com
SMTP_AUTH_CODE=your-smtp-authorization-code
```

使用 QQ 邮箱 SMTP 授权码，通过 TLS 连接；不要填写邮箱登录密码。
真实授权码仅保存在服务器 `.env`，不要提交。发信由运行环境的 Python 标准库完成，
无需新增邮件依赖。更改配置后运行 `./bin/stockdepth restart web`。

迁移新增 `signup_email_verifications`（验证码 HMAC 摘要、有效期、失败次数）和
`signup_email_limits`（发送频率计数）。验证码有效期 10 分钟、每邮箱发送间隔 60 秒、
每邮箱每小时最多 5 次、每来源每小时 20 次、全站每小时 100 次；来源计数使用摘要，
若反向代理转发来源地址，应由代理覆盖客户端传入的 IP 头。
连续输错 5 次需重新获取；重发后旧码失效。验证与创建账户处于同一事务，成功后码不能复用。
发信失败不会允许注册；接口不返回验证码，也不记录邮件内容或 SMTP 授权码。
过期验证码和频率记录随发送请求分批清理。

`scripts/tests/signup-email.ts` 使用独立临时 schema 和模拟发信测试，不向真实邮箱发送邮件。

## 模型额度不可用状态

模型调用明确返回免费额度耗尽、余额不足或 `insufficient_quota` 时，记录对应配置的
`unavailable_reason=quota_exhausted` 与 `unavailable_at`。任务回调只持久化错误类别，
不会为此记录原始错误内容。普通限流、网络错误和请求格式错误不触发额度停用。
分析模型列表、任务创建校验和默认模拟交易模型均排除该配置；排队/重试任务会检查
其配置是否已因额度不足而不可用，不自动替换模型或重新发起付费调用。

管理员 Models 页面显示“额度不足 · 不可用”。充值或开启后付费后，管理员可点击
“测试并恢复”（发起一次真实模型测试请求）；只有测试成功才清除不可用状态。
保存模型配置或勾选 Active 不会自行清除额度错误。恢复时保留手动 Active 设置。
配置版本与恢复检查时间用于防止旧任务错误覆盖更新后的凭据或成功恢复状态。

旧 runner 的失败记录可以显式回填，例如：
`tsx scripts/backfill-model-quota-status.ts 109 110`。
脚本仅使用已保存的失败证据，不请求模型；只标记能够唯一定位且版本未变的配置。
`scripts/tests/model-availability.ts` 使用隔离 schema 验证，不发起模型调用。

## 失败任务更换模型继续

分析页选择失败任务，在“更换模型并继续”展开 Quick / Deep 选择，确认后继续原任务。
只允许选择当前启用、未弃用、未被标记额度不足且支持对应角色的模型。
原来的 Continue 仍沿用原配置；原配置额度不足时，应使用更换模型入口。

接口：`POST /api/analysis/jobs/[id]/retry`，不传 body 时使用原配置；传入
`{"quickModelConfigId": 1, "deepModelConfigId": 2}` 时原子保存新配置快照并重新排队。
仅任务所有者的失败且未隐藏任务可以操作；并发提交只允许一次成功。
任务 ID、runId、首次开始时间、报告与历史模型调用不变，不重复扣分析额度。
运行器使用同一 runId 的检查点；有检查点时以新模型运行未完成节点，没有时从头执行。
后续请求按新模型的价格快照记录费用，旧调用费用保持原值。

迁移新增 `analysis_job_resumptions` 保存模型更换审计和加密配置快照。
任务详情只返回模型名称和更换时间，不返回快照、凭据或租约。
页面可查看“模型更换记录”。此操作不会自动执行；用户确认后才会继续调用模型。

`scripts/tests/resume-with-models.ts` 使用隔离 schema 验证权限、状态、加密历史、
重复请求、事务回滚和用量保留；`test_checkpoint_resume.py` 验证重建模型后只恢复未完成节点。

## 每日远端数据库备份副本

使用 `./bin/sync-database --check` 检查连接，`./bin/sync-database` 完整同步到独立备份库。
支持验证 TLS 的 PostgreSQL 直连或验证主机密钥的 SSH 隧道；覆盖前保留远端备份，
事务内更新失败则回滚。每天北京时间 03:00 的 systemd 模板位于 `deploy/systemd/`，
需连接验证和首次同步成功后再启用。配置及操作见 [数据库同步](docs/database-sync.md)。
