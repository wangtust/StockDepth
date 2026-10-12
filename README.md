# StockDepth

股票分析与模拟交易平台。网站、Python 分析 API、分析 worker 和模拟交易 worker 分开运行，统一使用根目录 `.env`。

## 项目结构

```text
apps/web/       Next.js 网站、登录、支付、管理接口及数据库迁移
apps/api/       Python 分析 API；stockdepth 下按 api、agents、workflows、data、providers 分层
apps/workers/   分析任务队列与模拟交易 worker
bin/stockdepth  统一启停入口
scripts/        服务管理与集成测试
docs/           架构说明
var/            自动生成的服务日志及进程记录
.env            唯一运行配置，不提交 Git
```

API 的 `cli` 和测试目录属于开发工具，不参与网站服务启动；各应用的许可证保留。详细模块边界见 [架构说明](docs/architecture.md)。

## 当前机器运行

当前环境和依赖已配置，PostgreSQL 已有 `saas_starter` 数据库。直接运行：

```bash
cd /root/StockDepth
./bin/stockdepth start api web analysis paper
./bin/stockdepth status api web analysis paper
```

浏览器访问 **http://localhost:3000**。分析 API 监听 `127.0.0.1:8008`。重复启动会跳过已运行服务。

```bash
# 停止全部服务
./bin/stockdepth stop api web analysis paper

# 重启全部服务，重新读取 .env
./bin/stockdepth restart api web analysis paper

# 查看日志
tail -f var/api.log var/web.log var/analysis.log var/paper.log
```

不带服务名时默认操作 api、web、analysis；paper 需要显式指定。worker 会处理数据库中待执行的任务。停止分析 API 会结束其分析子进程，已有检查点会保留；重启后可在任务页面重试。修改配置前建议等待正在执行的任务结束。

PostgreSQL 是独立系统服务，统一脚本不管理它。机器重启后若数据库未启动：

```bash
service postgresql start
```

## 环境配置

启动脚本读取根目录 `.env` 中的 `STOCKDEPTH_RUNTIME_BIN`，直接使用已安装的 Python、Node.js、pnpm 和 tsx，无需项目内的环境链接。当前配置指向 `/root/miniconda3/envs/tradingagents-saas/bin`，无需手动激活 Conda。

在新机器上创建环境并安装依赖：

```bash
conda create -n stockdepth -c conda-forge python=3.11 nodejs=22 -y
conda activate stockdepth
npm install -g pnpm tsx
cd /path/to/StockDepth
pnpm install
python -m pip install -e apps/api
```

然后在根目录 `.env` 中设置 `STOCKDEPTH_RUNTIME_BIN` 为该环境的绝对 bin 路径，可通过 `echo "$CONDA_PREFIX/bin"` 查看。新机器另需安装并启动 PostgreSQL，创建 `.env` 中指定的数据库和有权限的数据库用户。

## 唯一配置文件

新环境先执行以下命令；当前机器已有 `.env`，不要覆盖：

```bash
cp .env.example .env
chmod 600 .env
```

| 配置 | 用途 |
| --- | --- |
| STOCKDEPTH_RUNTIME_BIN | Python、Node、pnpm、tsx 所在环境的绝对 bin 路径 |
| POSTGRES_URL | PostgreSQL 连接地址及凭据 |
| BASE_URL | 网站地址，默认 http://localhost:3000 |
| AUTH_SECRET | 登录会话签名密钥，可用 `openssl rand -base64 32` 生成 |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | 支付与 webhook 验证；无需支付时可保留模板占位值 |
| STOCKDEPTH_API_URL | worker 调用分析 API 的地址 |
| STOCKDEPTH_API_USERNAME / PASSWORD | worker 的内部 API 调用凭据 |
| STOCKDEPTH_WEB_USERNAME / PASSWORD | API 验证凭据，须与上一项相同；不是网页登录账户 |
| STOCKDEPTH_WEB_HOST / PORT | 分析 API 监听地址和端口 |
| ANALYSIS_WORKER_* | 轮询、并发、模拟模式和任务超时参数 |
| STOCKDEPTH_OUTPUT_LANGUAGE / MAX_DEBATE_ROUNDS / MAX_RISK_ROUNDS / CHECKPOINT_ENABLED | 可选分析默认值，任务参数会覆盖它们 |

模型 Provider、Base URL、Quick/Deep Model 和 API Key 由管理员在模型管理页面保存到数据库，启用并设为默认后用户才能创建分析。worker 执行时读取对应模型记录，不使用 `.env` 中的模型兜底。API 与模型数据源需要可用网络。

## 数据库初始化与迁移

统一启动命令会先连接数据库：空库自动创建全部项目表、索引和约束，已有数据库自动应用尚未执行的结构更新，并验证所需表完整。失败时不会继续启动或重启服务。重复启动不会清空数据。

因此，新环境配置好数据库连接、安装依赖后，直接执行即可：

```bash
./bin/stockdepth start api web analysis paper
```

这一步只创建数据库内部结构，不创建 PostgreSQL 数据库本身，也不自动创建账户或 Stripe 商品。建表依据版本控制中的项目 SQL 结构文件，避免每次启动直接修改 schema 造成不可追踪的变更。连接用户需具有创建 schema、表和修改结构的权限。

需要单独执行结构更新时仍可使用：

```bash
conda activate stockdepth  # 当前机器使用 tradingagents-saas
pnpm --dir apps/web db:migrate
```

新环境如需初始化管理员账户，可运行 `pnpm --dir apps/web db:seed`，默认账户为 `test@test.com` / `admin123`，登录后修改密码。配置了真实 Stripe Key 时，seed 还会创建远端商品，因此只在需要初始化时运行。当前机器已有用户与数据，不需要 seed，也不要运行 db:setup 覆盖配置。

数据库保存用户、模型、任务、报告及模拟交易数据。分析文件和检查点在 `~/.stockdepth`。任务删除是软删除，可在 Account 的“最近删除”恢复，管理员仍可查看。

## 验证

```bash
conda activate stockdepth  # 当前机器使用 tradingagents-saas
pnpm --dir apps/web exec tsc --noEmit
pnpm --dir apps/workers exec tsc --noEmit
PYTHONPATH="$PWD/apps/api" python -m unittest discover -s apps/api/tests -p test_progress_reports.py -v
```

服务运行时，删除与恢复集成测试可执行 `node scripts/tests/job-visibility.cjs`。该测试使用临时任务，需要数据库已有至少两名普通用户和一名管理员，测试后清理临时数据。
