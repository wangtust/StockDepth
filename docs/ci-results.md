# CI results — Phase 0 / Phase 1

2026-10-14（北京时间）。Phase0审查和最小bootstrap真实验收完成，后续阶段未执行。

| Source SHA | Run | Job | Conclusion | Duration |
| --- | --- | --- | --- | --- |
| `0c9848e0e7e14aeca6a5cd9ef503c08d00744150` | [push run](https://github.com/wangtust/StockDepth/actions/runs/38518651341) | [Phase 0 static audit](https://github.com/wangtust/StockDepth/actions/runs/38518651341/job/115703068738) | success | 6s |

GET runs/jobs和真实job日志独立审阅：Node22.23.3/Python3.11.17，版本断言及7份manifest静态审查成功，hash与本地一致。job started05:48:51Z/completed05:48:57Z。无安装/业务套件/DB/browser验收。两实现者local_ready及112源、348冻结文件hash复核通过。

成本：一个ubuntu job实际6秒，5分钟超时上限；此为运行时长，不代表计费分钟或金额，套餐/计费未知。失败run无；Phase6受控失败/恢复未执行，不能提供虚构失败链接。runner提示旧action Node20运行时被强制Node24，业务Node22断言成功；后续审查action版本。

随后仅文档提交为doc-only followup，未改变测试源码，不由此声称新SHA运行通过。所验收source SHA始终为上述0c9848e。上述是Phase0当时的风险；Phase1下述入口已修复并验证，根锁双文档经pnpm12实际安装确认是原生格式。完整CI仍待Phase2–6。[矩阵](ci-test-inventory.md)、[架构](ci-architecture.md)、[设置](ci-setup.md)、[故障处理](ci-troubleshooting.md)。


## Phase 1 accepted — 北京时间2026-10-14 14:06:58

真实push source SHA `64c5763039943cb2007b142c55d3d53e328e4d21`；以下为GitHub API run/jobs和完整job日志独立验收，源码普通推送dev后才取得结果。

| Run | Job | Conclusion | Duration |
| --- | --- | --- | --- |
| [Phase1 push run 38520070810](https://github.com/wangtust/StockDepth/actions/runs/38520070810) | [Phase 1 clean clone offline regression](https://github.com/wangtust/StockDepth/actions/runs/38520070810/job/115707508400) | success | 162s（06:04:16–06:06:58 UTC） |
| [同时触发静态审查38520071007](https://github.com/wangtust/StockDepth/actions/runs/38520071007) | Phase 0 static audit | success | 7s；不能代替Phase1 |

实际Node22.23.3、root pnpm12.11.2、Python3.11.17；registry报告pnpm engines >=18.*，目标兼容未更改。全新checkout完整history；frozen lock install、Python require-hashes/pip check成功（55s），CI browser与系统依赖成功（21s）；两workspace tsc（19s）；统一test-all（51s）实际299 passed/1 integration deselected/9既有warnings（pytest9.02s）及4前端套件passed，无skip。原断言独立比对保持；Python/前端synthetic removed=true，always专属venv删除成功（2s）。当前browser为锁定Playwright1.58.2下载的Chromium v1208。

前端覆盖：管理员独立模型保存、未保存同伴编辑、真实SWR迟到隔离、五视口报告/Markdown、全屏ESC滚动/焦点恢复、体验pending/重复提交/错误关联/任务race/取消删除。现有冻结actions/7ae2378祖先断言实际执行。Python离线socket限制仅本轮loopback Mock，legacy串行checkpoint现场生成恢复通过。未访问prod env/DB/server，不调用真实LLM/交易。

本地有效证据与remote源码hash一致，复用两owner验证：fresh安装37.342s、frontend39.934s、Python9.189s和两类型检查exit0；coordinator独立303业务文件hash不变、22份JS断言调用序列及Python37个assert AST保持。私有before/hash、完整API jobs和日志、cleanup及两handoff保存在var/codex-ci-team，均未提交。

失败/恢复链接：本轮没有失败的GitHub run，没有虚构恢复run。三次本地infra失败及恢复准确日志见[troubleshooting](ci-troubleshooting.md)，不是远端失败证据。Phase6受控失败尚未执行；Phase1成功不能声称已有完整故障演练。

成本：Phase1实际一个ubuntu job162秒、20分钟上限；本次伴随静态job7秒，共169秒job时长。非计费分钟/金额，GitHub套餐/账单未知，没有收费LLM。action运行时Node20被runner强制Node24的warning保留；业务Node22实际核对通过。缓存/分层优化留Phase6。

随后六ci文档及PLAN发布为doc-only followup，路径过滤不触发新Phase1 run；实际tested source始终64c5763，不能把followup SHA冒称通过。main仍8f8857216031e937dc0ef2750b69391ed5998d59。Phase1无验收阻塞；Phase2–6尚未运行，完整CI/build/PG16/security/故障恢复无法通过的原因是尚未实现和实际执行。只完成本阶段，等待调度器放行。

Required checks建议见[setup](ci-setup.md)：已真实出现的Phase1 job可用于复现检查，完整门禁待以后真实证据；私有套餐能力和设置权限未知，不自动配置保护规则。


## Phase 2 PR CI — 2026-10-15

新增统一 CI 已在 [PR #1](https://github.com/wangtust/StockDepth/pull/1) 实际运行：[run 38702176804](https://github.com/wangtust/StockDepth/actions/runs/38702176804)，tested source `6689bb6a395ce6099f2fcf52d5db041dff13c8e3`。类型检查、Python 离线测试、4 套前端回归、生产构建及 CI required 全部成功。Python 309 passed、1 integration deselected、9 warnings。完整设计、job 时长及验证边界见 [第二阶段执行](ci-phase2-execution.md)。未合并 PR，未部署；后续数据库/安全/故障演练尚未完成。


## Phase 3–6 accepted and deployed — 2026-10-15

[失败演练38706000895](https://github.com/wangtust/StockDepth/actions/runs/38706000895)确认exit42及汇总失败；[恢复38706637161](https://github.com/wangtust/StockDepth/actions/runs/38706637161)与[main38707075289](https://github.com/wangtust/StockDepth/actions/runs/38707075289)均11 job全绿。Python309、前端13套、数据库8套、安全6套及两类依赖/历史凭据扫描通过，6份报告上传成功。PR #2 merge `202e63d`已部署，应用构建、28表检查及只读HTTP验收通过；详见[完整实施](ci-completion.md)。当前App缺少分支保护管理权限，未声称已强制启用保护。
