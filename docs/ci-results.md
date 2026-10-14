# CI results — Phase 0

2026-10-14（北京时间）。Phase0审查和最小bootstrap真实验收完成，后续阶段未执行。

| Source SHA | Run | Job | Conclusion | Duration |
| --- | --- | --- | --- | --- |
| `0c9848e0e7e14aeca6a5cd9ef503c08d00744150` | [push run](https://github.com/wangtust/StockDepth/actions/runs/38518651341) | [Phase 0 static audit](https://github.com/wangtust/StockDepth/actions/runs/38518651341/job/115703068738) | success | 6s |

GET runs/jobs和真实job日志独立审阅：Node22.23.3/Python3.11.17，版本断言及7份manifest静态审查成功，hash与本地一致。job started05:48:51Z/completed05:48:57Z。无安装/业务套件/DB/browser验收。两实现者local_ready及112源、348冻结文件hash复核通过。

成本：一个ubuntu job实际6秒，5分钟超时上限；此为运行时长，不代表计费分钟或金额，套餐/计费未知。失败run无；Phase6受控失败/恢复未执行，不能提供虚构失败链接。runner提示旧action Node20运行时被强制Node24，业务Node22断言成功；后续审查action版本。

随后仅文档提交为doc-only followup，未改变测试源码，不由此声称新SHA运行通过。所验收source SHA始终为上述0c9848e。完整CI尚不能验收：根锁双文档/Python锁缺失/绝对browser和pnpm内部路径/var历史输入/root env需后续处理。[矩阵](ci-test-inventory.md)、[架构](ci-architecture.md)、[设置](ci-setup.md)、[故障处理](ci-troubleshooting.md)。
