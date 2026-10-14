# CI architecture — Phase 0

2026-10-14（北京时间）。仅 phase0-audit.yml：dev push（审查源码/清单路径）及手动触发，contents: read，Node22/Python3.11，5分钟超时，静态 manifest 断言。没有安装 pnpm、Python业务依赖、浏览器或 PostgreSQL。pnpm 根版本12.11.2和PG16是后续环境目标。

Phase1环境复现、Phase2分层业务CI、Phase3 PG16恢复、Phase4浏览器、Phase5安全、Phase6成本/故障演练均未验收。[矩阵](ci-test-inventory.md)记录候选入口。
