# stockdepth → stockdepth_dev 数据迁移

当前结构已进入 0044 字段收敛阶段：删除 23 个重复字段，新增旧任务证据表。以下兼容阶段内容为历史记录；当前字段与升级要求以[字段收敛说明](database-normalization.md)为准。

2026-10-16已完成。原stockdepth保持只读、未改结构或数据；stockdepth_dev保留原有管理员和模型配置，合并旧业务记录。工具：[migrate-legacy-database.ts](../scripts/migrate-legacy-database.ts)。

## 迁移结果

| 内容 | 新库结果 |
| --- | --- |
| 用户 | 8人；同邮箱管理员合并，保留新库密码，其他7人的原密码哈希保留 |
| 任务 / 报告 | 112个任务、886份报告 |
| 模型调用 / 换模历史 | 591条调用、23条换模记录 |
| 模型配置 / 不可变版本 | 30条配置（含新库原有1条）、29个可靠配置版本 |
| 积分 | 总余额153；126条旧流水及1条新库初始赠送，未重复赠送 |
| 自选股 / 模拟账户 | 11条自选、1个组合、3条持仓、4条成交、9条决策 |
| 行情 | 37个股票身份、902条报价、7986条日线（迁移时计数） |
| 外键 | 72条全部已验证 |

旧库剩余用户行为、管理员审计、结构化结论和行情调度/运行历史也已迁移。新环境已存在的分析定价和并发配置保留；注册验证码及发送频率窗口不导入。

## 合并与安全规则

- 同邮箱管理员仍是同一账号，保留新库登录密码和既有10积分真实流水，不叠加第二笔10积分。其他用户以旧余额作为新账本切换基线；旧流水保留为空序号的历史证据，不补造历史赠送。
- 新库已有模型ID1，旧模型ID1映射为30；新库已有流水ID1，旧流水ID1映射为127。任务、调用、快照、换模记录和审计中的关联按映射处理。
- 模型密钥经过本地解密校验，明文兼容值转为加密存储，不输出凭据。只有可靠快照转换为任务版本；94个无完整快照的旧任务继续legacy_unknown，591条旧调用不伪造版本引用。
- 新库原有模型ID1缺少API Key，保留配置内容但设为停用、不作默认模型，待填写密钥后手动启用。导入的可用配置中保留有效默认选择。
- 3个旧running任务导入为failed，external_status=migration_paused，并保留报告、Token和Checkpoint标识，用户可确认后手动继续。3条未结束调用记为interrupted，不补造费用。
- 所有旧Worker所有权、租约和进程号清空；模拟交易待提交任务暂停，已提交未知结果不自动重复调用。原先停用的paper服务保持停用。
- 所有报告正文、调用数值、持仓、成交金额和行情值在事务内核对；积分基线+新序号流水与余额逐账户核对；序列只前移，不回退。

## 备份与验证

本次备份在本机 `var/backups/legacy-import-2026-10-16T04-38-36-730Z/`，目录及文件限制权限，不提交Git：

- source.dump / target.dump：停写后的双库备份，pg_restore --list校验通过。
- environment.before：当时环境配置，包含私密设置。
- rehearsal-report.json：原目标备份还原到临时数据库后的完整导入演练。
- collision-report.json：强制任务ID冲突与用户前向邀请引用的额外演练。
- import-report.json：实际导入结果、源内容摘要、工具摘要、完整ID映射。
- idempotency-report.json：重复执行未产生重复记录。

两种演练均包含重复导入数据摘要不变检查。实际写入前检查工具、源数据与目标数据均未偏离演练。实际导入在一个事务内完成；源连接以repeatable-read/read-only读取。审计表另存database.legacy_import事件及ID映射。

## 工具用法

先停止应用写入，使用pg_dump生成命名为source.dump和target.dump的备份，存放在受限目录。然后：

```bash
node apps/web/node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/migrate-legacy-database.ts --rehearse --backup-dir <备份目录>
node apps/web/node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/migrate-legacy-database.ts --rehearse --collision-check --backup-dir <备份目录>
node apps/web/node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/migrate-legacy-database.ts --apply --backup-dir <备份目录>
./bin/stockdepth start api web analysis market
```

默认源stockdepth、目标stockdepth_dev，可用--source/--target显式指定。源码和数据已变化时必须重新演练；已有导入标记但源发生变化时拒绝增量重导，避免重复账目。首次导入工具用于本轮兼容结构，不是任意数据库的通用同步器。

本次采用旧库完整快照与新库已知初始状态合并。若未来新库有更多用户、支付、交易或同名配置冲突，应重新核对合并规则与演练结果，不能绕过冲突检查。回退前也必须保存迁移后产生的新写入，不直接覆盖回滚。
