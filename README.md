# StockDepth

StockDepth 是股票分析与模拟交易平台，支持多智能体分析、分析任务与报告管理、模拟交易，以及管理员模型配置、用户管理和订阅支付。任务列表和详情显示运行耗时及输入、输出、总 token，详情可查看每个 agent 的模型调用耗时和用量。

## 项目架构

项目由四个独立服务组成，统一读取根目录 `.env`：

| 服务 | 目录 | 职责 |
| --- | --- | --- |
| Web | `apps/web` | Next.js 网站，负责登录、管理页面、任务与报告展示、支付 |
| 分析 API | `apps/api` | Python 多智能体分析，负责模型调用、行情与新闻数据、报告和检查点 |
| 分析 worker | `apps/workers` | 从数据库领取分析任务，调用 API 并同步结果 |
| 模拟交易 worker | `apps/workers` | 处理模拟交易任务与决策 |

PostgreSQL 保存用户、模型、任务、报告与模拟交易数据，并作为 worker 的持久任务队列。分析文件和检查点默认保存在 `~/.stockdepth`。服务启停由 `bin/stockdepth` 统一管理，详细架构见 [架构说明](docs/architecture.md)。

## 环境配置

以下步骤默认已准备好 PostgreSQL 数据库和数据库用户，且连接用户具有创建和修改项目表结构的权限。

### 1. 创建运行环境并安装依赖

```bash
conda create -n stockdepth -c conda-forge python=3.11 nodejs=22 -y
conda activate stockdepth
npm install -g pnpm tsx

cd ./StockDepth
pnpm install
python -m pip install -e apps/api
```

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

其他配置可保留 `.env.example` 中的默认值。无需支付时，Stripe 配置可保留模板占位值。模型供应商、模型名称、服务地址和 API Key 在登录后的模型管理页面配置，保存在数据库中。管理员还可分别配置 Quick/Deep 模型的输入、缓存命中、输出价格（人民币元 / 百万 tokens）。每组全部填写或全部留空，0 表示免费；管理员任务列表和详情可查看估算费用，普通用户页面不显示价格或费用。调用记录保存当时的价格，后续改价不影响历史；缺少缓存用量时显示普通输入价计算的上限估算，缺少价格或 token 时费用未知。

## 启动流程

### 1. 启动服务

在项目根目录执行：

```bash
./bin/stockdepth start api web analysis paper
./bin/stockdepth status api web analysis paper
```

启动命令会先连接数据库、自动执行迁移并检查项目表，然后初始化管理员并启动服务。初始化失败时会停止启动；重复执行会跳过已运行的服务，不会清空数据。

当数据库中没有未删除的管理员时，启动脚本根据 `STOCKDEPTH_ADMIN_EMAIL` 和 `STOCKDEPTH_ADMIN_PASSWORD` 创建 `super_admin`。已有管理员时保留原账户和密码，修改 `.env` 不会重置密码。两项均未配置时跳过创建；仅配置一项、配置无效或邮箱已被其他账户使用时会停止启动。无需手动执行 `db:seed`。

启动会同时应用任务用量统计的迁移，创建 `analysis_model_calls` 明细表和任务 token 汇总字段；新数据库也会按迁移顺序创建完整结构。耗时从首次开始到结束，继续任务时包含中间等待时间。Token 统计包含已记录的重试请求；供应商没有返回 usage、失败或中断时标记为统计不完整，不估算为零。历史任务无法追溯补齐 token。

### 2. 访问网站并配置模型

本机访问 **http://localhost:3000**，云服务器访问 **http://服务器公网IP:3000**。网站监听 `0.0.0.0:3000`，公网访问需在实例安全组和系统防火墙放行 TCP 3000。分析 API 默认监听 `127.0.0.1:8008`，供内部服务调用。

首次登录使用 `.env` 中配置的管理员邮箱和密码。进入模型管理页面，添加模型供应商、Base URL、Quick/Deep Model 和 API Key，启用并设为默认后即可创建分析任务。分析服务需要能访问相应模型服务和行情、新闻数据源。

### 3. 查看日志与启停

```bash
# 查看服务日志
tail -f var/api.log var/web.log var/analysis.log var/paper.log

# 修改 .env 后重启并重新加载配置
./bin/stockdepth restart api web analysis paper

# 停止服务
./bin/stockdepth stop api web analysis paper
```

也可单独操作服务，例如 `./bin/stockdepth restart web`。不指定服务名时默认操作 `api web analysis`，模拟交易 `paper` 需要显式指定。PostgreSQL 由系统或外部数据库服务管理，启停脚本不管理它。
