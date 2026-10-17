# CI troubleshooting — Phase 1

2026-10-14（北京时间）。用已授权GitHub connector GET `repos/wangtust/StockDepth/actions/runs?branch=dev`核对push event、source SHA、run/job/steps/logs。PR-only fetch_commit_workflow_runs不作为push证据；push成功不代表CI通过。认证或权限拒绝写私有github-access-request.md，blocker_type=external_access，不用返修重试掩盖。

真实失败先保存run和job日志，再交相应owner：workflow归coordinator，依赖/锁/env-*归environment，runner/fixture归tests；禁止越权改业务或减断言。业务缺陷等用户授权。无continue-on-error、忽略退出码或空选择；失败恢复run与成功列表分开。Phase6受控失败尚未执行。

本地已恢复的普通失败：tracked Worker node_modules链接导致fresh install失败（环境owner删除）；standalone Python launcher的stdlib定位失败（解析真实解释器）；Playwright非公开./cli导出失败（tests改公开pnpm exec）。日志均保留私有handoff，不能当作GitHub失败run。pnpm12双文档根锁是已验证原生格式，不扁平化。

缺browser执行明确installer和系统依赖；浅clone破坏原ancestor断言时使用fetch-depth:0。统一入口拒绝root.env，Python只允许本轮bind的loopback端口。PG16集成尚未执行，不运行加载生产env的旧诊断。

Rollback按角色before/hash或普通dev revert本轮源码提交；先核对当前after hash，禁止whole-tree reset、force/main操作。仅文档followup可单独revert。恢复Worker旧依赖链接会重现clean clone缺陷；回滚不改变生产服务，也不触发部署。


## 完整CI云端问题与恢复（2026-10-15）

- artifact默认排除隐藏目录；使用非隐藏专用ci-reports目录，继续将缺失报告视为失败。
- PG容器内部地址/端口不同于宿主映射；先限制连接URL为专用loopback CI服务，再比较管理员连接与套件连接的实际服务身份。
- 历史模板无效占位符在文档示例中也会被扫描；只对精确值及两个已审查路径允许，不豁免文件和目录。生成canary仍失败且脱敏。
- 历史frontend脚本依赖未跟踪var回执/before源码；用最新套件及明确after模式验证当前源码。当前功能的payload/事务和界面标题要更新对应夹具，不能跳过业务断言。
- 首次coordinator SSR套件超时根因未确定；增加阶段日志和15秒CDP超时后恢复及main连续通过，180秒总时限不变。
- 有root.env的工作区会被CI入口拒绝；实际测试只能在干净clone进行，不能删除应用.env来绕过隔离。

失败及恢复run、tested SHA、部署回滚材料位置见[完整记录](ci-completion.md)。


2026-10-15 最后dev同步run 38707782968暴露当前experience测试初始页面固定900ms等待的竞态（MOCK尚未渲染）。改为最多10秒、每50ms检查document complete和实际fixture内容的就绪等待，保留后续全部原断言；不是自动重试失败suite，也不是放宽断言。
