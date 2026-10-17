# CI setup

CI 已发布到 main；无需提供应用数据库、支付、模型或部署 secrets。GitHub Actions 页面选择 CI 可以手动运行；integration 也有单独手动入口。完整证据与权限边界见 [实施记录](ci-completion.md)。

本地复现必须使用无应用 dotenv、无历史 var 的干净 clone，完整 Git 历史；Ubuntu/Linux x86_64、Node22、Python3.11、根 packageManager 的 pnpm。venv 必须是新的专属临时路径：

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

调用方 finally 删除自建 clone/venv；测试入口自行删除临时夹具。浏览器支持 FRONTEND_CHROMIUM；分组使用 --group=admin / experience / coordinator。可将 CI_REPORT_DIR 设为专用非隐藏目录 ci-reports 获取 JUnit/JSON。

数据库入口 node scripts/ci/test-integration.cjs 只接受显式 CI_POSTGRES_URL，要求专用 PostgreSQL16 服务、127.0.0.1、非5432端口、stockdepth_ci角色和stockdepth_ci_admin库；不得指向项目库。GitHub integration.yml 自动提供该服务及健康检查。请在本地自行创建独立临时服务并确保 finally 清理，不复用应用 PG 集群。

依赖扫描：pnpm audit --audit-level=high；独立工具venv安装pip-audit==2.10.1，执行 pip-audit --no-deps --disable-pip -r apps/api/requirements-ci.lock。Gitleaks 安装脚本校验固定版本二进制，扫描使用 --redact --config .gitleaks.toml --log-opts=--all。

合并保护：Settings → Rules → Rulesets，为main/dev要求PR并选择实际出现的 CI required 检查、禁止force push。连接器缺少管理权限（403），未替用户启用规则。私有仓库能力以当前账号界面为准。
