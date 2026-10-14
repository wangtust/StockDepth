# CI setup — Phase 0

仅 dev 普通提交推送，不修改 main。bootstrap 不需要 secrets，checkout/setup runtimes需要GitHub网络，审查命令自身离线。运行 `python3 scripts/ci/env-audit.py`，不运行生产管理器。

后续根 pnpm 锁需合成单文档并验证 frozen install；Python3.11需锁定含hash依赖；浏览器需安装并传入 FRONTEND_CHROMIUM；DB只使用独立PG16容器生成随机URL。当前均未完成。

Required checks建议：当前只可考虑实际验收后的 `Phase 0 static audit`，它仅证明静态审查。完整检查名在Phase2后确定。GitHub Settings → Rules → Rulesets选择目标分支及已真实产生的check；由用户决定配置，不自动修改。私有仓库套餐及规则权限未知，不推断支持。
