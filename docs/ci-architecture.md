# CI architecture — Phase 1

> 2026-10-15：已开始第二阶段，当前实现与分阶段计划见 [CI 第二阶段执行](ci-phase2-execution.md)。以下保留第一阶段历史说明；第二阶段远端验收尚未完成。

2026-10-14（北京时间）。Phase0静态bootstrap保留。新增phase1-reproducibility.yml仅dev路径push及手动触发；一个 `Phase 1 clean clone offline regression` job，ubuntu-latest、20分钟超时、contents: read、同ref取消旧run。checkout fetch-depth:0保留冻结业务断言所需祖先。

执行顺序：Node22/Python3.11 → 动态读取根packageManager并安装确切pnpm → env-check → 根锁冻结与Python哈希安装 → CI Chromium和系统依赖 → Web/Worker types → test-all默认all。pytest离线socket限制、合成checkpoint与四个浏览器组件套件都保留断言。各runner finally清理合成输出，workflow always步骤删除专属venv；GitHub临时runner释放其余workspace/browser依赖。没有secrets、prod env、应用DB、正式server、收费LLM或部署。

Phase1只证明安装与本轮离线入口可复现。[实际结果](ci-results.md)、[覆盖矩阵](ci-test-inventory.md)。Phase2独立CI jobs/build、Phase3隔离PG16、Phase4完整browser、Phase5安全、Phase6缓存/成本/受控失败均待调度器放行，不在本轮实现。
