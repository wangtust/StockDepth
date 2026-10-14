# CI troubleshooting — Phase 1

2026-10-14（北京时间）。用已授权GitHub connector GET `repos/wangtust/StockDepth/actions/runs?branch=dev`核对push event、source SHA、run/job/steps/logs。PR-only fetch_commit_workflow_runs不作为push证据；push成功不代表CI通过。认证或权限拒绝写私有github-access-request.md，blocker_type=external_access，不用返修重试掩盖。

真实失败先保存run和job日志，再交相应owner：workflow归coordinator，依赖/锁/env-*归environment，runner/fixture归tests；禁止越权改业务或减断言。业务缺陷等用户授权。无continue-on-error、忽略退出码或空选择；失败恢复run与成功列表分开。Phase6受控失败尚未执行。

本地已恢复的普通失败：tracked Worker node_modules链接导致fresh install失败（环境owner删除）；standalone Python launcher的stdlib定位失败（解析真实解释器）；Playwright非公开./cli导出失败（tests改公开pnpm exec）。日志均保留私有handoff，不能当作GitHub失败run。pnpm12双文档根锁是已验证原生格式，不扁平化。

缺browser执行明确installer和系统依赖；浅clone破坏原ancestor断言时使用fetch-depth:0。统一入口拒绝root.env，Python只允许本轮bind的loopback端口。PG16集成尚未执行，不运行加载生产env的旧诊断。

Rollback按角色before/hash或普通dev revert本轮源码提交；先核对当前after hash，禁止whole-tree reset、force/main操作。仅文档followup可单独revert。恢复Worker旧依赖链接会重现clean clone缺陷；回滚不改变生产服务，也不触发部署。
