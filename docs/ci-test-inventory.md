# CI test environment inventory — Phase 0 audit / Phase 1 update

日期：2026-10-14（北京时间）。审查完成；远端静态 bootstrap 已真实验收，见 [结果](ci-results.md)。所有候选业务测试命令均未在本阶段执行。

根锁独立复核：两个 YAML 文档，第二文档含 apps/web、apps/workers importers；旧 tests handoff 的 importer 缺失判断已纠正。



| 文件/入口 | 作用、真实命令（根 cwd，另注除外） | 依赖与每 push 适合性 |
| --- | --- | --- |
| package.json | packageManager=pnpm@12.11.2；check:web、check:workers；根 build/start 指向 bin/stockdepth | 静态审查适合每 push；禁止运行管理器 build/start，可能触发生产管理行为 |
| pnpm-workspace.yaml | apps/web、apps/workers；allowBuilds 允许 esbuild/sharp/oxide | 统一根安装边界；原生构建需要平台一致；当前未安装验证 |
| pnpm-lock.yaml | pnpm 自身依赖及第二 YAML 文档的 web/workers importers | 两个 `---`/lockfileVersion/importers 文档；不能只认定缺失 importer。Phase1 实际pnpm12证明双文档为原生格式，保持并通过 frozen install；见下方Phase1矩阵（registry网络必需） |
| apps/web/pnpm-lock.yaml | 旧 web 独立 lock | 与根锁双重权威风险；Phase1 明确唯一根锁，禁止按旧内部 store 路径推断依赖完整 |
| apps/web/package.json / apps/workers/package.json | Next15、TS5.9.3、Worker tsx；`pnpm --dir apps/web exec tsc --noEmit --incremental false`；`pnpm --dir apps/workers exec tsc --noEmit --incremental false` | 类型检查是每 push 候选，安装复现后验证；web build 需单独审查 import/env/DB 行为，Phase0 未运行 |
| apps/api/pyproject.toml | setuptools 包装、Python >=3.10、pytest markers；`PYTHONPATH=apps/api python3.11 -m pytest -c apps/api/pyproject.toml apps/api/tests -m "not integration" -q` | 没有 test extra 或精确 transitive 锁；目标使用3.11。not integration 不是网络隔离证明，fixtures/import 必须审查；非空收集/退出码必须保留 |
| apps/web/drizzle.config.ts、lib/db/schema.ts、lib/db/migrations | schema/迁移；配置主动 dotenv ../../.env。现有入口 `pnpm --dir apps/web exec drizzle-kit migrate` | **仅列入口，不批准执行**；现配置加载根 env。后续使用临时 clone 无 root.env 与 PG16 测试容器、显式随机测试URL、finally清理。迁移/重复/约束在集成 job，不作为 Phase0通过证据 |
| scripts/ci/env-audit.py::main | `python3 scripts/ci/env-audit.py`；从脚本位置定位根并检查7个manifest/workspace文件与hash | stdlib、零DB/browser/network/mock；不加载env、不安装包；适合 Phase0 每 push 静态 bootstrap；不解析完整YAML、不验证可安装性 |

### 测试环境边界与真实候选命令（未执行）

完整逐文件清单及匹配行由 tests 独立审查提供：`var/codex-ci-team/stage0-tests-inventory.md`、`stage0-tests-inventory.json`；它们属于另一 owner，本角色只读取，不修改。下述为环境侧聚合，不能把命令列出解释为运行通过。

- 前端 Phase1：`node scripts/tests/frontend-experience-stage1.cjs`、`node scripts/tests/frontend-admin-stage1.cjs`、`node scripts/tests/frontend-coordinator-stage1.cjs`；Phase2 对应 stage2；Phase3 对应 stage3 并有 pages/navigation/report；Phase4 `node scripts/tests/frontend-experience-stage4.cjs after`、`node scripts/tests/frontend-experience-pages-stage4.cjs after`、`node scripts/tests/frontend-admin-interactions-stage4.cjs after`、`node scripts/tests/frontend-admin-forms-stage4.cjs after`、`node scripts/tests/frontend-admin-race-stage4.cjs`、`node scripts/tests/frontend-coordinator-interactions-stage4.cjs after`。浏览器是真实 Chromium，本地组件通过 esbuild 打包、Mock API/navigation/SWR 等 fixture；不是正式服务 E2E。常见硬编码 `/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`、`node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild`、postcss/Tailwind内部路径；部分支持 FRONTEND_CHROMIUM，不能认为全部已支持。before 模式依赖未跟踪 var 历史源码；after 也需逐条检查输入。修复可移植性/依赖后适合每 push 浏览器 job；原状不适合 clean clone。
- Python Stage1：`PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage1-timing.py`（Mock node/tool/model/report，输出 var/performance）；Stage2–4：`PYTHONPATH=apps/api python3.11 -m pytest -c apps/api/pyproject.toml apps/api/tests/test_stage2_python.py -q`，同样选择 test_stage3_python.py / test_stage4_python.py。Stage3 229行读取 `var/codex-performance-team/stage3-python-before/apps/api/stockdepth/workflows/setup.py`，属于未追踪输入，不能 clean clone 重现。Stage2–4 的 mock 测试需禁止外部网络并审查凭据来源；离线候选不是已验证每 push 清单。没有独立 test_stage1_python.py，不能凭命名虚构入口。
- Worker：`pnpm --dir apps/workers exec tsx tests/stage1-stability.ts`、`tests/stage2-sync.ts`、`tests/stage3-admission.ts` 为 DB/mock 套件；polling/version-polling 部分依赖 var。故障恢复入口 `node scripts/diagnostics/stage1-recovery.cjs`、`node scripts/diagnostics/stage1-worker-tests.cjs`、`node scripts/diagnostics/worker-stage4-soak.cjs`。原脚本 root .env、POSTGRES_URL、var baseline/source 与 runtime bin 必须先隔离；禁止直接运行。STOCKDEPTH_RUNTIME_BIN 应来自本次安装的 workspace tsx；mock loopback API、不收费LLM。DB/lease/crash/recovery 适合 PG16 集成 job；soak 有时长成本，不自动推荐每 push。
- DB/browser/network/mock 是不同边界：静态 bootstrap 全无；类型检查安装后通常离线；组件浏览器需要安装 browser、loopback mock；Python pytest marker 不能保证离线；Worker 故障恢复需要仅测试 PG16 和本地 mock HTTP。历史 browser-latency/数据库 stats 等加载根 env 或正式服务的诊断不得搬进 CI。


## 逐文件命令与依赖矩阵

以下自动审查标签表示需要人工检查的匹配，配置/发布脚本不是测试，var-fixture/output 必须区分输入和输出。stage4 race 入口实际无需 after 参数。禁止直接执行加载根 env 的入口。

# Phase0 tests independent inventory (北京时间 2026-10-14)

Static source audit only. Commands below are real source entry commands, **not executed**. JSON companion contains every matching source line and snapshot SHA256. No product or test assertion changed.

| Path | Actual entry / cwd | Source dependencies | Every-push suitability |
| --- | --- | --- | --- |
| `apps/api/pyproject.toml` | `configuration; no test execution` | root-env | Needs portable fixture/browser and isolated env |
| `apps/api/tests/__init__.py` | `support module; no standalone test selection` | package marker | Not a runnable suite; select nonempty tests/test_*.py suites |
| `apps/api/tests/conftest.py` | `support module; no standalone test selection` | pytest shared fixtures; local mock; inherited environment requires isolation | Not a runnable suite; select nonempty tests/test_*.py suites |
| `apps/api/tests/test_analyst_execution.py` | `cd apps/api && python3.11 -m pytest tests/test_analyst_execution.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_anthropic_effort.py` | `cd apps/api && python3.11 -m pytest tests/test_anthropic_effort.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_api_key_env.py` | `cd apps/api && python3.11 -m pytest tests/test_api_key_env.py -m "not integration" -q` | root-env, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/api/tests/test_capabilities.py` | `cd apps/api && python3.11 -m pytest tests/test_capabilities.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_checkpoint_resume.py` | `cd apps/api && python3.11 -m pytest tests/test_checkpoint_resume.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_compatible_timeout.py` | `cd apps/api && python3.11 -m pytest tests/test_compatible_timeout.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_costs.py` | `cd apps/api && python3.11 -m pytest tests/test_costs.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_crypto_asset_mode.py` | `cd apps/api && python3.11 -m pytest tests/test_crypto_asset_mode.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_dataflows_config.py` | `cd apps/api && python3.11 -m pytest tests/test_dataflows_config.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_deepseek_reasoning.py` | `cd apps/api && python3.11 -m pytest tests/test_deepseek_reasoning.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_env_overrides.py` | `cd apps/api && python3.11 -m pytest tests/test_env_overrides.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_execution_timing.py` | `cd apps/api && python3.11 -m pytest tests/test_execution_timing.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_google_api_key.py` | `cd apps/api && python3.11 -m pytest tests/test_google_api_key.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_interaction_identity.py` | `cd apps/api && python3.11 -m pytest tests/test_interaction_identity.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_memory_log.py` | `cd apps/api && python3.11 -m pytest tests/test_memory_log.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_minimax.py` | `cd apps/api && python3.11 -m pytest tests/test_minimax.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_model_probe.py` | `cd apps/api && python3.11 -m pytest tests/test_model_probe.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_model_validation.py` | `cd apps/api && python3.11 -m pytest tests/test_model_validation.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_multi_model_clients.py` | `cd apps/api && python3.11 -m pytest tests/test_multi_model_clients.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_ollama_base_url.py` | `cd apps/api && python3.11 -m pytest tests/test_ollama_base_url.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_progress_reports.py` | `cd apps/api && python3.11 -m pytest tests/test_progress_reports.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_provider_rate_limit.py` | `cd apps/api && python3.11 -m pytest tests/test_provider_rate_limit.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_runner_credentials.py` | `cd apps/api && python3.11 -m pytest tests/test_runner_credentials.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_runner_registry.py` | `cd apps/api && python3.11 -m pytest tests/test_runner_registry.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_safe_ticker_component.py` | `cd apps/api && python3.11 -m pytest tests/test_safe_ticker_component.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_signal_processing.py` | `cd apps/api && python3.11 -m pytest tests/test_signal_processing.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_stage2_python.py` | `cd apps/api && python3.11 -m pytest tests/test_stage2_python.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_stage3_python.py` | `cd apps/api && python3.11 -m pytest tests/test_stage3_python.py -m "not integration" -q` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/api/tests/test_stage4_python.py` | `cd apps/api && python3.11 -m pytest tests/test_stage4_python.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_structured_agents.py` | `cd apps/api && python3.11 -m pytest tests/test_structured_agents.py -m "not integration" -q` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_ticker_symbol_handling.py` | `cd apps/api && python3.11 -m pytest tests/test_ticker_symbol_handling.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/api/tests/test_usage.py` | `cd apps/api && python3.11 -m pytest tests/test_usage.py -m "not integration" -q` |  | Offline candidate; verify under Phase1 contract before enablement |
| `apps/web/drizzle.config.ts` | `configuration; no test execution` | root-env, DB | Needs portable fixture/browser and isolated env |
| `apps/web/package.json` | `configuration; no test execution` | root-env, DB | Needs portable fixture/browser and isolated env |
| `apps/web/pnpm-lock.yaml` | `configuration; no test execution` | root-env, browser, DB | Needs portable fixture/browser and isolated env |
| `apps/workers/package.json` | `configuration; no test execution` | root-env, DB | Needs portable fixture/browser and isolated env |
| `apps/workers/tests/resource-benchmark.ts` | `cd apps/workers && pnpm exec tsx tests/resource-benchmark.ts` | var-fixture/output | Needs portable fixture/browser and isolated env |
| `apps/workers/tests/stage1-stability.ts` | `cd apps/workers && pnpm exec tsx tests/stage1-stability.ts` | DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/workers/tests/stage2-polling.ts` | `cd apps/workers && pnpm exec tsx tests/stage2-polling.ts` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/workers/tests/stage2-sync.ts` | `cd apps/workers && pnpm exec tsx tests/stage2-sync.ts` | DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/workers/tests/stage2-version-polling.ts` | `cd apps/workers && pnpm exec tsx tests/stage2-version-polling.ts` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/workers/tests/stage3-admission.ts` | `cd apps/workers && pnpm exec tsx tests/stage3-admission.ts` | DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `apps/workers/tsconfig.json` | `configuration; no test execution` |  | Offline candidate; verify under Phase1 contract before enablement |
| `package.json` | `configuration; no test execution` |  | Offline candidate; verify under Phase1 contract before enablement |
| `pnpm-lock.yaml` | `configuration; no test execution` | root-env, browser, DB | Needs portable fixture/browser and isolated env |
| `pnpm-workspace.yaml` | `configuration; no test execution` |  | Offline candidate; verify under Phase1 contract before enablement |
| `scripts/diagnostics/browser-latency.cjs` | `node scripts/diagnostics/browser-latency.cjs` | root-env, absolute-path, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/coordinator-stage2-dependencies.cjs` | `node scripts/diagnostics/coordinator-stage2-dependencies.cjs` | root-env, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/coordinator-stage2-joint.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/coordinator-stage2-joint.py` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `scripts/diagnostics/coordinator-stage2-recovery.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/coordinator-stage2-recovery.py` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `scripts/diagnostics/coordinator-stage4-verify.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/coordinator-stage4-verify.py` | absolute-path, var-fixture/output, DB | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/database-query-plan.ts` | `configuration; no test execution` | root-env, DB | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/database-stats.cjs` | `node scripts/diagnostics/database-stats.cjs` | root-env, DB | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/latency.cjs` | `node scripts/diagnostics/latency.cjs` | root-env, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/measure-stage.cjs` | `node scripts/diagnostics/measure-stage.cjs` | var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/paper-baseline.cjs` | `node scripts/diagnostics/paper-baseline.cjs` | root-env, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/polling-regression.cjs` | `node scripts/diagnostics/polling-regression.cjs` | root-env, absolute-path, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/portfolio-browser.cjs` | `node scripts/diagnostics/portfolio-browser.cjs` | root-env, absolute-path, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/push-frontend-dev.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/push-frontend-dev.py` | absolute-path, var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/push-verified-dev.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/push-verified-dev.py` | absolute-path, var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/read-load.k6.js` | `configuration; no test execution` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `scripts/diagnostics/round5-ownership-audit.cjs` | `node scripts/diagnostics/round5-ownership-audit.cjs` | root-env, DB | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/run-load.cjs` | `node scripts/diagnostics/run-load.cjs` | root-env, absolute-path, var-fixture/output, DB | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage1-baseline.cjs` | `node scripts/diagnostics/stage1-baseline.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage1-recovery.cjs` | `node scripts/diagnostics/stage1-recovery.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage1-timing.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage1-timing.py` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage1-worker-tests.cjs` | `node scripts/diagnostics/stage1-worker-tests.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage2-python-benchmark.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage2-python-benchmark.py` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage2-python-data-benchmark.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage2-python-data-benchmark.py` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage3-python-benchmark.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage3-python-benchmark.py` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage3-python-recovery.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage3-python-recovery.py` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `scripts/diagnostics/stage3-python-timing.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage3-python-timing.py` | var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/stage4-python-graph-soak.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage4-python-graph-soak.py` | localhost/mock | Offline candidate; verify under Phase1 contract before enablement |
| `scripts/diagnostics/stage4-python-isolation.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/stage4-python-isolation.py` | root-env, var-fixture/output, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-capacity.cjs` | `node scripts/diagnostics/worker-capacity.cjs` | root-env, var-fixture/output, DB | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage2-tests.cjs` | `node scripts/diagnostics/worker-stage2-tests.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage3-contract.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/worker-stage3-contract.py` | var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage3-permissions.cjs` | `node scripts/diagnostics/worker-stage3-permissions.cjs` | root-env, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage3-regression.cjs` | `node scripts/diagnostics/worker-stage3-regression.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage3-sync.cjs` | `node scripts/diagnostics/worker-stage3-sync.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage3-tests.cjs` | `node scripts/diagnostics/worker-stage3-tests.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage4-browser.cjs` | `node scripts/diagnostics/worker-stage4-browser.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage4-evidence.py` | `PYTHONPATH=apps/api python3.11 scripts/diagnostics/worker-stage4-evidence.py` | var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage4-http.cjs` | `node scripts/diagnostics/worker-stage4-http.cjs` | root-env, pnpm-internal, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage4-polling.cjs` | `node scripts/diagnostics/worker-stage4-polling.cjs` | pnpm-internal, var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage4-regression.cjs` | `node scripts/diagnostics/worker-stage4-regression.cjs` | var-fixture/output | Needs portable fixture/browser and isolated env |
| `scripts/diagnostics/worker-stage4-soak.cjs` | `node scripts/diagnostics/worker-stage4-soak.cjs` | root-env, var-fixture/output, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-forms-stage4.cjs` | `node scripts/tests/frontend-admin-forms-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-interactions-stage4.cjs` | `node scripts/tests/frontend-admin-interactions-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-model-save-stage1.cjs` | `node scripts/tests/frontend-admin-model-save-stage1.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-model-save-stage2.cjs` | `node scripts/tests/frontend-admin-model-save-stage2.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-navigation-stage3.cjs` | `node scripts/tests/frontend-admin-navigation-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-race-stage4.cjs` | `node scripts/tests/frontend-admin-race-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-report-stage3.cjs` | `node scripts/tests/frontend-admin-report-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-stage1.cjs` | `node scripts/tests/frontend-admin-stage1.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-stage2.cjs` | `node scripts/tests/frontend-admin-stage2.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-admin-stage3.cjs` | `node scripts/tests/frontend-admin-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-coordinator-admin-extra-stage3.cjs` | `node scripts/tests/frontend-coordinator-admin-extra-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, DB, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-coordinator-interactions-stage4.cjs` | `node scripts/tests/frontend-coordinator-interactions-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-coordinator-stage1.cjs` | `node scripts/tests/frontend-coordinator-stage1.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-coordinator-stage2.cjs` | `node scripts/tests/frontend-coordinator-stage2.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-coordinator-stage3.cjs` | `node scripts/tests/frontend-coordinator-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-interactions-stage4.cjs` | `node scripts/tests/frontend-experience-interactions-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-pages-stage3.cjs` | `node scripts/tests/frontend-experience-pages-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-pages-stage4.cjs` | `node scripts/tests/frontend-experience-pages-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-stage1.cjs` | `node scripts/tests/frontend-experience-stage1.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-stage2.cjs` | `node scripts/tests/frontend-experience-stage2.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-stage3.cjs` | `node scripts/tests/frontend-experience-stage3.cjs` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |
| `scripts/tests/frontend-experience-stage4.cjs` | `node scripts/tests/frontend-experience-stage4.cjs after` | absolute-path, pnpm-internal, var-fixture/output, browser, localhost/mock | Needs portable fixture/browser and isolated env |


## Phase 1 reproducibility matrix — 2026-10-14（北京时间）

上方逐文件矩阵保留Phase0原始审查发现，不表示全部历史入口已移植。Phase1实际入口如下；本地两receipt已核对，远端结果见[ci-results](ci-results.md)。

| 入口 | Phase1选择与边界 | 证据/后续范围 |
| --- | --- | --- |
| env-check.py / env-install.py | Node22；pnpm12.11.2完全等于root packageManager；Python3.11；根frozen lock、Python require-hashes、pip check | 全新clone本地安装37.342s；远端同入口；删除tracked Worker依赖链接 |
| test-all.py | 默认all，分项python/frontend；失败传播 | 统一无root.env入口，无生产管理器 |
| test-python.py | 全部not integration；299 passed、1明确deselected；外部socket被阻止 | 合成legacy checkpoint模板已追踪、tmp现场生成/finally清理；PG16后续Phase3 |
| test-frontend.cjs | admin forms、真实SWR race、coordinator fullscreen/scroll、experience interactions，4非空套件 | Playwright1.58.2可安装browser及系统依赖；FRONTEND_CHROMIUM可覆盖；输出finally清理 |
| Web/Worker tsc | 两workspace公开exec入口 | 仅类型检查；未运行生产build/start |
| 22个旧frontend脚本 | 移植公共依赖解析与browser路径，保持原assert序列 | 只运行上列4套件；历史before比较仍不纳入CI；完整矩阵留Phase4 |
| Worker DB/lease/crash、security、full CI | Phase1未运行 | Phase2–6尚未验收，不能当required checks已有绿灯 |

独立coordinator比对22个JavaScript断言调用序列和Python37个assert AST，均保留；两owner成功测试源hash与发布候选一致。完整Git历史必须保留，已有7ae2378 ancestor/frozen actions断言不得削弱。
