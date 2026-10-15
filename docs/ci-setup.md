# CI setup — Phase 1

> 2026-10-15：第二阶段已通过本地及 GitHub PR 验证，当前实现与分阶段计划见 [CI 第二阶段执行](ci-phase2-execution.md)。以下保留第一阶段历史说明；第二阶段 run 38702176804 的五个 job 全部通过，后续阶段仍待实施。

2026-10-14（北京时间）。仅dev普通提交推送；main不改。全新clone无root.env，先安装Node22、Python3.11与根packageManager的pnpm12.11.2。实际registry版本/engines与Node22运行已核对，没有更改目标。pnpm12根锁原生双YAML文档由真实frozen install接受；旧web独立lock不作为CI安装入口。

从仓库根执行，venv使用全新专属临时路径：

```bash
python3.11 scripts/ci/env-check.py
python3.11 scripts/ci/env-install.py --venv /tmp/stockdepth-ci-venv
node scripts/ci/test-frontend.cjs --install-browser --with-deps
pnpm --dir apps/web exec tsc --noEmit --incremental false
pnpm --dir apps/workers exec tsc --noEmit --incremental false
/tmp/stockdepth-ci-venv/bin/python scripts/ci/test-all.py
```

调用方finally删除专属venv/clone；测试runner自行finally删除合成fixture输出。browser支持FRONTEND_CHROMIUM显式可执行路径，默认使用锁定Playwright安装；不依赖宿主绝对路径。需完整Git历史保留既有ancestor断言。安装需要registry/PyPI/Playwright/apt网络，运行测试仅本地Mock。Python依赖由pyproject首次锁定为requirements-ci.lock（uv0.9.5、3.11、hashes），安装不复用应用venv。Linux x86_64已验证；其他平台未验证。

Required checks建议：真实通过后可考虑 `Phase 1 clean clone offline regression`，以及仅作静态审查的 `Phase 0 static audit`。完整CI名称留Phase2以后确定。GitHub Settings → Rules → Rulesets选择目标分支及已有真实check，由用户配置；不自动修改。私有仓库套餐/规则权限未知，不推断支持。DB仅后续隔离PG16容器，禁止应用/云库。
