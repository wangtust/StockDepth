# CI 实施计划与第二阶段执行

> 当前完整实现、验证边界和发布记录见 [CI 完整实施](ci-completion.md)。下方保留先前阶段记录。

更新：2026-10-15。起点 `f4e643f`；工作分支 `ci/phase2-checks`。
本轮由用户授权继续 CI 工作，不使用旧 tmux 调度器；历史 Phase 0/1 验收记录继续保留。

## 分阶段交付

| 阶段 | 工作与验收 | 当前状态 |
| --- | --- | --- |
| 2 基础门禁 | dev push、面向 dev/main 的 PR、手动触发；类型/Python/前端/build 独立 job；统一失败传播；干净副本验证 | 已实现，本地及 GitHub PR run 全部通过 |
| 3 数据库集成 | PostgreSQL 16 临时 service，随机测试库；全量迁移、重复迁移、约束、Worker 抢占/lease/恢复、账务幂等；finally 清理 | 待实施，先审查现有测试的固定端口、dotenv 和历史 var 输入 |
| 4 前端扩展 | 将剩余可移植套件纳入统一入口，验证真实安装的 Chromium；保留原有断言 | 待实施；现有 4 套回归已纳入第二阶段 |
| 5 安全 | 凭据扫描、锁文件依赖审查、JWT/管理员/密钥暴露测试；扫描失败必须可见 | 待实施；产品缺陷单独处理 |
| 6 运行验收 | 获取各 job 真实运行链接、SHA、时长；受控失败及恢复；根据结果设置合并门禁 | 待真实 GitHub 运行；不以本地通过代替 |

不包含生产部署、真实模型调用和交易。工作区存在应用 `.env`，所有业务验证在 `/tmp` 干净本地 clone 进行，不读取应用配置。

## 第二阶段设计

`.github/workflows/ci.yml` 提供 `Type checks`、`Python offline tests`、`Frontend regression`、`Web production build` 四个独立 job。`CI required` 使用 `always()` 汇总所有结果，只接受全部 `success`；failed/cancelled/skipped 都失败。PR 不使用 paths 过滤，以便作为稳定的 required check。并发组包含事件类型及 PR 编号/ref，取消同一 PR 的过期运行，不互相取消 push 和 PR。

`.github/actions/setup-ci/action.yml` 统一 Node22/Python3.11、根 packageManager 确切版本和锁文件安装。Node job 只安装 JS 依赖；Python job 只安装哈希锁定的 Python 包到 runner.temp 下的新 venv。缓存只有 pnpm 内容 store 和 pip 下载目录，不缓存 node_modules、venv、应用数据、密钥或构建产物；命中缓存仍执行锁定安装。

`build-web.cjs` 拒绝根目录及 apps/web 下的 dotenv 文件，使用白名单系统变量和固定合成 DB/Auth/Stripe 配置，执行 `pnpm --dir apps/web build`。数据库指向 loopback 端口 1，构建阶段不提供数据库。构建仍可能下载 next/font/google 字体，需要外网；这是生产构建验证，不是离线测试或应用启动验收。

使用官方 setup-node/setup-python/checkout v7 和 cache v6；版本来源：
[setup-node](https://github.com/actions/setup-node)、[setup-python](https://github.com/actions/setup-python)、[checkout](https://github.com/actions/checkout)、[cache](https://github.com/actions/cache)。事件、权限与汇总配置遵循 [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。

原 phase0/phase1 workflow 保留，以免已有 check 被无提示移除；dev push 暂时会重复执行部分测试。统一 CI 取得远端绿灯后，再单独退役旧 workflow 并更新保护规则，避免切换期间失去已有门禁。

## 本地验证

2026-10-15 本地实际结果：

| 检查 | 结果 |
| --- | --- |
| Node 22.23.3 / pnpm 12.11.2 / Python 3.11.14 | 版本检查通过 |
| JS frozen install / Python require-hashes + pip check | 分别按 node/python scope 安装通过 |
| Web / Worker tsc --noEmit --incremental false | 两者退出码 0 |
| Python 离线测试 | 309 passed、1 integration deselected、9 warnings，9.70 秒 |
| 既有前端回归 | 4 套全部通过；合成输出清理成功 |
| Next.js production build | 退出码 0；成功编译并完成 29/29 页面生成；路由按需动态渲染 |
| actionlint 1.7.12 | 全部现有和新增 workflow 检查通过 |
| 汇总检查故障验证 | 全 success 通过；failure/cancelled/skipped 均拒绝 |
| 构建入口隔离与失败传播 | 有应用 .env 时立即拒绝；过滤继承的模型/数据库变量；子命令 exit 23 原样传递 |

日志保留于本地忽略目录 `var/ci-phase2/`，不提交构建产物和测试环境。远端验证见下方；本地结果与远端结果分列。

干净副本具有完整 Git 历史，并复制本轮 CI 脚本；不复制应用 .env、node_modules 或 var。安装使用共享下载缓存，但依赖链接及 Python venv 都重新创建。并行 job 的云端调度、cache 服务、PR 合并提交和权限需要真实 GitHub run 验证。

## GitHub 实际验收

草稿 [PR #1](https://github.com/wangtust/StockDepth/pull/1)，目标 main；只新增工作分支及 PR，没有合并或修改 main/dev。源码提交 `6689bb6a395ce6099f2fcf52d5db041dff13c8e3`。
[CI run 38702176804](https://github.com/wangtust/StockDepth/actions/runs/38702176804) 的 jobs 和日志已逐项检查，全部成功：

| Job | 实际时长 | 结果 |
| --- | --- | --- |
| Type checks | 47s | Web / Worker 均通过 |
| Python offline tests | 72s | 309 passed、1 integration deselected、9 warnings；pytest 7.86s；venv 清理成功 |
| Frontend regression | 88s | 4 套通过；合成输出清理成功 |
| Web production build | 82s | Next.js 编译、类型、页面生成、trace 均通过 |
| CI required | 5s | All four CI jobs passed |

总 job 执行时间 294 秒；各任务并行，不能把该合计当作端到端时长或实际账单。官方 actions v7/cache v6 已在本次 hosted runner 实际运行成功。
本次没有 GitHub 失败 run；故障传播仅在本地验证，远端受控失败与恢复仍属阶段 6。保护规则尚未更改；待用户选择启用时可将 `CI required` 设为必需检查。

此后证据文档提交与上述 tested source SHA 区分；CI 未做路径过滤，文档提交也会触发新的 PR run。
