# StockDepth

StockDepth is a stock analysis and paper trading platform with multi-agent analysis, job and report management, historical decision charts, model configuration, user administration, and subscription billing. Job details include execution times, model calls, and token usage.

The interface is in English. New analysis reports default to English; users can select Chinese when creating an analysis. Existing reports retain their original language.

## Architecture

| Service | Directory | Responsibility |
| --- | --- | --- |
| Web | `apps/web` | Next.js interface, authentication, reports, administration, and payments |
| Analysis API | `apps/api` | Adapted TradingAgents analysis, model calls, data tools, and checkpoints |
| Analysis worker | `apps/workers` | Claims database jobs, calls the API, and stores results |
| Paper trading worker | `apps/workers` | Processes simulated trading tasks and decisions |
| Market worker | `apps/workers` | Synchronizes instrument identities, quotes, and daily prices |

PostgreSQL stores users, models, jobs, reports, and paper trading records, and serves as the persistent job queue. All services read the root `.env` and are managed through `bin/stockdepth`. Analysis files and checkpoints default to `~/.stockdepth`.

## Installation and configuration

Requirements: PostgreSQL, Python 3.11, Node.js 22, and the pnpm version specified in the root `package.json`. For example, with Conda:

```bash
conda create -n stockdepth -c conda-forge python=3.11 nodejs=22 -y
conda activate stockdepth
npm install -g pnpm@12.11.2 tsx@4.23.15
pnpm install --frozen-lockfile
python -m pip install -e apps/api
cp .env.example .env
chmod 600 .env
```

Do not overwrite an existing `.env`. Configure the following using `.env.example`:

- `STOCKDEPTH_RUNTIME_BIN`: the environment executable directory. Run `echo "$CONDA_PREFIX/bin"` after activating the environment to find it.
- `POSTGRES_URL`: an existing PostgreSQL database. The database user needs permission to create and migrate application tables. URL-encode special characters in the password.
- `BASE_URL`: the browser-facing website address, such as `http://localhost:3000`.
- `AUTH_SECRET`: generate a random secret with `openssl rand -base64 32`.
- `STOCKDEPTH_ADMIN_EMAIL` and `STOCKDEPTH_ADMIN_PASSWORD`: initial administrator credentials. The password must contain 8–100 characters and at most 72 UTF-8 bytes.
- `STOCKDEPTH_API_USERNAME / PASSWORD` and `STOCKDEPTH_WEB_USERNAME / PASSWORD`: matching internal service credentials, separate from website accounts.
- `STOCKDEPTH_MODEL_KEY_ID` and `STOCKDEPTH_MODEL_KEYRING`: model API key encryption material; see below.
- `SMTP_HOST`, `SMTP_PORT`, `EMAIL_SENDER`, and `SMTP_AUTH_CODE`: registration verification email settings. The current integration uses QQ SMTP over TLS on port 465 and requires an SMTP authorization code.
- Stripe credentials: configure these when using subscription payments.

Configure model providers, service URLs, model names, and API keys in the administrator model page after signing in. Adding a model or testing its availability makes a real model request and may incur charges. Input, cache hit, and output prices support cost estimation; missing usage is not treated as zero cost.

## Running the application

```bash
./bin/stockdepth build
./bin/stockdepth start api web analysis market paper
./bin/stockdepth status api web analysis market paper
```

Startup connects to PostgreSQL, applies migrations, and creates the initial administrator if no undeleted administrator exists. Changing `.env` does not reset existing administrator passwords. Invalid or incomplete initial administrator settings prevent startup.

The website defaults to `0.0.0.0:3000`; the analysis API defaults to `127.0.0.1:8008`. Configure network access for remote deployments. Add and enable models before creating analysis or paper trading tasks.

```bash
# Restart after configuration changes
./bin/stockdepth restart api web analysis market paper
# View logs
tail -f var/api.log var/web.log var/analysis.log var/market.log var/paper.log
# Stop services
./bin/stockdepth stop api web analysis market paper
```

Without explicit service names, commands operate on `api web analysis market`; include `paper` explicitly for paper trading. PostgreSQL is managed separately. After changing the website, stop Web, build it, and start Web again. Use `pnpm dev` for local website development.

Configure global and per-user analysis concurrency in Admin → System. Request limits, timeouts, and market batch settings are documented in `.env.example`. Models with exhausted quota become unavailable. After replenishing quota, administrators can use **Test and restore**. Failed analysis jobs can continue with replacement models while preserving reports and usage history.

## Market data and historical decisions

The stock pages provide shared instrument search, quotes, and daily prices. Watchlists, portfolios, trades, and reports are scoped to each user. The market worker synchronizes enabled catalogue instruments only. Data availability depends on external providers. Trading calendars approximate weekdays, time zones, and lunch breaks; full holiday and early-close calendars are not included.

To initialize the instrument catalogue for existing records, run from `apps/workers` with the configured runtime:

```bash
tsx src/market-worker.ts --initialize-catalog
```

Initialization is bounded by a batch limit. Repeat until `initialized=0`. New reports automatically produce decision records. To process existing reports, run from the repository root using the runtime's `tsx`:

```bash
tsx scripts/backfill-analysis-decisions.ts
```

Historical decision charts show the current user's completed, visible analyses. Daily prices are unadjusted. Reference prices and AI suggestions are not execution prices. Missing or stale quotes produce incomplete portfolio valuations; automated paper trades without valid quotes are skipped.

## Keys and data management

Model API keys use AES-256-GCM encryption. `STOCKDEPTH_MODEL_KEYRING` is a JSON mapping from key IDs to independently generated random 32-byte base64url keys. `STOCKDEPTH_MODEL_KEY_ID` selects the key used for new writes. Do not derive encryption keys from authentication secrets or model API keys. Missing encryption material blocks encrypted reads and new key saves.

Back up the keyring securely alongside your backup procedures, but store it separately from database backups. To rotate keys, first distribute a keyring containing both old and new keys to all services, then switch the write key ID. Keep old keys needed to decrypt historical data.

To migrate existing plaintext model configurations, first ensure that Web and both analysis and paper workers have compatible readers and the encryption configuration, then run:

```bash
tsx scripts/model-key-migrate.ts
# Apply only after every reader is ready
STOCKDEPTH_MODEL_READERS_READY=true tsx scripts/model-key-migrate.ts --apply
```

The default is a dry run. Rotation uses `--rotate --apply` and does not delete old decryption keys. The market history retention tool currently supports previews only; automatic production deletion is disabled.

Optional database mirroring uses `DATABASE_SYNC_*` settings from the root `.env`. The destination must be a dedicated backup database: synchronization overwrites its application data.

```bash
./bin/sync-database --check
./bin/sync-database
```

Direct connections require `DATABASE_SYNC_SSLROOTCERT` and server certificate verification. Alternatively, use an SSH tunnel with verified host keys. The destination PostgreSQL major version must be at least the source version. Install `pg_dump`, `pg_restore`, and `psql` matching the source version. The destination is backed up before replacement, and restoration runs in a transaction. Backups are stored under the Git-ignored `var/database-sync/` directory.

The `deploy/systemd/` templates schedule daily synchronization at 03:00 Asia/Shanghai. Verify the runtime user and project paths, test connectivity, and complete a manual synchronization before installing the timer. The backup tool does not copy `.env` or encryption keys.

## Development checks

GitHub Actions workflows are in `.github/workflows/`. To reproduce CI, use a clean clone without application `.env` files or runtime data and a disposable environment:

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

Database integration tests use `node scripts/ci/test-integration.cjs` and require an explicit `CI_POSTGRES_URL`: dedicated PostgreSQL 16 on `127.0.0.1`, a port other than 5432, the `stockdepth_ci` role, and the `stockdepth_ci_admin` database. Never run write tests against application databases.

## License and attribution

Original StockDepth code is licensed under the [Apache License 2.0](LICENSE). The overall application architecture, business workflows, and database design were created by the StockDepth author. Third-party code retains its original copyright and license notices:

- The analysis backend is adapted from [Tauric Research / TradingAgents](https://github.com/TauricResearch/TradingAgents), with its [Apache-2.0 license](apps/api/LICENSE) preserved. StockDepth adds service integration, task execution, model configuration, and report persistence adaptations.
- The frontend is adapted from [Next.js SaaS Starter](https://github.com/nextjs/saas-starter), with its [MIT license and Vercel copyright notice](apps/web/LICENSE) preserved.

Original copyrights remain with their respective holders. The root license does not override third-party licenses. Other dependencies remain subject to their own licenses.

StockDepth is intended for research and paper trading. Analysis results are not investment advice. Market data, news, and model services remain subject to their providers' usage and redistribution terms.
