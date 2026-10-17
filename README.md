# StockDepth

StockDepth 是股票分析与模拟交易平台，提供多智能体分析、任务与报告管理、股票历史决策图、模拟交易、模型配置、用户管理及订阅支付。任务详情可查看运行耗时、模型调用与 token 用量。

## 架构

| 服务 | 目录 | 职责 |
| --- | --- | --- |
| Web | `apps/web` | Next.js 网站、身份认证、报告展示、管理与支付 |
| 分析 API | `apps/api` | 基于 TradingAgents 修改的多智能体分析、模型调用、数据工具及检查点 |
| 分析 worker | `apps/workers` | 从数据库领取分析任务，调用 API 并保存结果 |
| 模拟交易 worker | `apps/workers` | 模拟交易任务与决策执行 |
| 行情 worker | `apps/workers` | 股票身份、报价和日线同步 |

PostgreSQL 保存用户、模型、任务、报告和模拟交易数据，并提供持久任务队列。服务统一读取根目录 `.env`，通过 `bin/stockdepth` 管理；分析文件和检查点默认位于 `~/.stockdepth`。

## 安装与配置

需要 PostgreSQL、Python 3.11、Node.js 22，以及根 `package.json` 指定版本的 pnpm。以下以 Conda 为例：

```bash
conda create -n stockdepth -c conda-forge python=3.11 nodejs=22 -y
conda activate stockdepth
npm install -g pnpm@12.11.2 tsx@4.23.15
pnpm install --frozen-lockfile
python -m pip install -e apps/api
cp .env.example .env
chmod 600 .env
```

已有 `.env` 时不要覆盖。按 `.env.example` 配置以下内容：

- `STOCKDEPTH_RUNTIME_BIN`：上述环境的可执行文件目录，可在激活环境后运行 `echo "$CONDA_PREFIX/bin"` 获取。
- `POSTGRES_URL`：已创建的 PostgreSQL 数据库，连接用户须具备创建和迁移项目表的权限。URL 中密码的特殊字符需要编码。
- `BASE_URL`：浏览器访问的网站地址，本地默认为 `http://localhost:3000`。
- `AUTH_SECRET`：可用 `openssl rand -base64 32` 生成。
- `STOCKDEPTH_ADMIN_EMAIL`、`STOCKDEPTH_ADMIN_PASSWORD`：首次创建管理员的邮箱与密码；密码须为 8–100 个字符，UTF-8 长度不超过 72 字节。
- `STOCKDEPTH_API_USERNAME / PASSWORD` 与 `STOCKDEPTH_WEB_USERNAME / PASSWORD`：两组内部服务凭据必须分别一致，与网页登录账户分开配置。
- `STOCKDEPTH_MODEL_KEY_ID`、`STOCKDEPTH_MODEL_KEYRING`：模型 API Key 的加密材料，见下文。
- `SMTP_HOST`、`SMTP_PORT`、`EMAIL_SENDER`、`SMTP_AUTH_CODE`：注册邮箱验证码配置。当前使用 QQ SMTP（端口 465），填写 SMTP 授权码。
- Stripe 配置：使用订阅支付时配置相应密钥。

模型供应商、服务地址、模型名称和 API Key 在登录后的模型管理页面配置。新增模型及“测试并恢复”会发起真实模型请求，可能产生费用。输入、缓存命中、输出价格可用于估算任务费用，缺失用量时不会当作零费用。

## 启动与日常使用

```bash
./bin/stockdepth build
./bin/stockdepth start api web analysis market paper
./bin/stockdepth status api web analysis market paper
```

启动会连接数据库、自动执行迁移，并在没有未删除管理员时创建初始管理员。已有管理员的密码不会被 `.env` 重置；初始账户配置不完整或无效时启动会失败。

网站默认监听 `0.0.0.0:3000`，分析 API 默认监听 `127.0.0.1:8008`。远程访问时配置相应网络入口。登录后先添加并启用模型，再创建分析或模拟交易任务。

```bash
# 修改配置后重启
./bin/stockdepth restart api web analysis market paper
# 查看日志
tail -f var/api.log var/web.log var/analysis.log var/market.log var/paper.log
# 停止服务
./bin/stockdepth stop api web analysis market paper
```

不指定服务时默认操作 `api web analysis market`，模拟交易 `paper` 需显式指定。PostgreSQL 由系统或外部服务管理。更新网页后先停止 Web、重新 build，再启动 Web；本地网页开发使用 `pnpm dev`。

分析任务的全局和每用户并发在 Admin → System 设置。模型请求限流、超时和行情批量参数见 `.env.example`。模型额度不足时相应配置会标记为不可用；管理员充值后需通过“测试并恢复”恢复。失败任务可在详情页选择模型继续，历史报告、调用和用量保留。

## 行情与历史决策

股票页面提供共享股票搜索、报价和日线，关注、组合、交易和报告按用户隔离。行情 worker 只同步目录中启用的股票；行情依赖外部供应商，不保证每只股票都有数据。交易日历采用星期、时区和午休的近似规则，未覆盖完整节假日及提前收盘日历。

已有数据需要初始化股票目录时，在配置好运行环境的 `apps/workers` 目录执行：

```bash
tsx src/market-worker.ts --initialize-catalog
```

初始化有批次上限，可重复执行直到 `initialized=0`。新报告会自动提取最终决策；已有报告可在根目录使用运行环境中的 `tsx` 执行：

```bash
tsx scripts/backfill-analysis-decisions.ts
```

历史决策图展示当前用户已完成且未隐藏的分析。日线为未复权价格，参考价与 AI 建议价不代表实际成交价。报价缺失或过期时，组合估值会标记为不完整，自动模拟交易会跳过无有效报价的执行。

## 密钥与数据管理

模型 API Key 使用 AES-256-GCM 加密。`STOCKDEPTH_MODEL_KEYRING` 是“密钥 ID → 随机 32 字节 base64url 密钥”的 JSON；`STOCKDEPTH_MODEL_KEY_ID` 指定当前写入使用的 ID。材料须独立生成，不应由认证密钥或模型 API Key 派生。缺少材料会阻止密文读取及新密钥保存。

数据库备份须配套安全保管 keyring，避免将密钥与数据库备份存放在同一处。轮换时先向所有服务分发包含新旧密钥的 keyring，再切换写入 ID，保留解密历史数据所需的旧密钥。

已有明文模型配置需要迁移时，先确保 web、analysis、paper 全部加载兼容的读取逻辑与加密配置，再运行：

```bash
tsx scripts/model-key-migrate.ts
# 确认所有读取服务已准备好后，才执行实际迁移
STOCKDEPTH_MODEL_READERS_READY=true tsx scripts/model-key-migrate.ts --apply
```

默认只预览；轮换使用 `--rotate --apply`，不会删除旧解密材料。历史行情清理工具当前仅支持预览，不提供生产自动删除。

可选数据库备份使用根 `.env` 的 `DATABASE_SYNC_*` 配置，目标必须是专用备份库，完整同步会覆盖其应用数据：

```bash
./bin/sync-database --check
./bin/sync-database
```

直连需配置 `DATABASE_SYNC_SSLROOTCERT` 并验证目标证书，或通过已验证主机密钥的 SSH 隧道连接。目标 PostgreSQL 主版本不得低于主库；需准备匹配主库版本的 `pg_dump`、`pg_restore`、`psql`。覆盖前会备份目标库，恢复在事务中执行；备份位于 Git 忽略的 `var/database-sync/`。

`deploy/systemd/` 提供每天北京时间 03:00 的定时模板。安装前核对运行用户和项目路径，先验证连接及手动同步成功。备份工具不复制 `.env` 和加密密钥。

## 开发验证

GitHub Actions 配置位于 `.github/workflows/`。在没有应用 `.env` 和运行数据的干净克隆中，可使用独立环境复现 CI：

```bash
python3.11 scripts/ci/env-install.py --venv /tmp/stockdepth-ci-venv
node scripts/ci/test-frontend.cjs --install-browser --with-deps
pnpm --dir apps/web exec tsc --noEmit --incremental false
pnpm --dir apps/workers exec tsc --noEmit --incremental false
/tmp/stockdepth-ci-venv/bin/python scripts/ci/test-python.py
node scripts/ci/test-frontend.cjs
node scripts/ci/test-security.cjs
node scripts/ci/build-web.cjs
```

集成测试入口为 `node scripts/ci/test-integration.cjs`，仅接受显式的 `CI_POSTGRES_URL`，要求专用 PostgreSQL 16、`127.0.0.1`、非 5432 端口、`stockdepth_ci` 角色与 `stockdepth_ci_admin` 数据库。不要使用应用数据库运行写入测试。

## 开源协议与来源

StockDepth 项目原创代码采用 [Apache License 2.0](LICENSE)。项目整体架构、业务流程和数据库设计由 StockDepth 作者设计；以下第三方代码及其版权和许可声明继续保留：

- 分析后端基于 [Tauric Research / TradingAgents](https://github.com/TauricResearch/TradingAgents) 修改，保留 [Apache-2.0 协议](apps/api/LICENSE)。StockDepth 对其进行了服务集成、任务执行、模型配置与报告持久化等适配。
- 前端基于 Vercel 的开源模板修改，保留 [MIT 协议及 Vercel 版权声明](apps/web/LICENSE)。当前仓库尚未确认模板的具体上游仓库地址。

原始版权归各自权利人所有。根协议不覆盖或撤销第三方许可；其他依赖按各自协议使用。

本项目用于研究与模拟交易，分析结果不构成投资建议。行情、新闻及模型服务的使用与再分发还须遵守相应供应商条款。
