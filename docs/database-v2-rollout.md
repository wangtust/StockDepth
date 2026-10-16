# 数据库 V2：独立库验证与兼容阶段

当前结构已进入 0044 字段收敛阶段：删除 23 个重复字段，新增旧任务证据表。以下兼容阶段内容为历史记录；当前字段与升级要求以[字段收敛说明](database-normalization.md)为准。

2026-10-16。V2数据库名为 `stockdepth_dev`，运行服务及根 `.env` 均使用该库，保留 `.next-v2` 生产构建目录。本地Git分支为 `dev`。旧业务数据已合并导入，原 `stockdepth` 仍保留不动，详见 [迁移记录](legacy-database-import.md)。完整目标设计见 [database-v2.md](design/database-v2.md)。

## 已实施

- 业务表从28张扩为30张：新增 billing_accounts、llm_model_config_versions。
- 积分账户为权威余额，所有注册赠送、邀请奖励、管理员调整、分析扣费和Stripe充值统一写顺序账本；余额、流水、业务变动同事务。
- 每用户流水序号/操作键唯一，Stripe session全局唯一；重复支付幂等、并发扣费不透支、受控新流水不可修改删除。
- 旧库升级时只保存真实切换余额为账本基线，保留旧流水，不推测历史赠送或Token。
- 新模型任务绑定Quick/Deep不可变加密版本，模拟分析入口同样固定版本；配置变化新增版本，旧任务不追随当前配置变化。
- 换模审计与模型调用增加版本引用，Web→Worker→Python→用量同步贯通；旧调用没有证据时版本仍为空。
- 交易建议模型在明确领取处理边界固定版本，提交后中断不盲目重复调用。
- 固定版本保留模型参数与价格，但不会绕过配置身份的启用/退役/额度状态；未发送的新请求仍检查身份可用性。
- 模型版本不可UPDATE/DELETE；配置当前版本、任务及调用的版本/配置归属由外键约束。
- 旧密钥调用的延迟额度错误不能禁用已经轮换密钥的配置；现有恢复事件时间栅栏保留。
- 管理页面、当前用户和任务列表读取独立计费账户。报告保持已有索引和按需正文读取。

迁移0040新增表/列及基线和触发器，0041补任务版本归属/账户外键，0042补调用版本归属及状态约束，0043把新用户旧余额列默认值设为0，赠送必须通过真实流水。schema.ts和Drizzle快照同步。

## 兼容边界

这是分阶段计划的可运行兼容阶段，**不是所有旧列已经删除的最终结构**。users旧余额/Stripe字段、任务完整配置快照和旧配置ID继续双写；Worker优先版本，旧任务沿用既有安全恢复限制。

日期/timezone和JSON字段转换、股票身份NOT NULL清理、最终冗余列删除、队列领取SQL/索引替换仍属后续独立迁移。当前不为百行任务数据增加未证明有收益的多套索引。

原库仍运行旧迁移时不能让新版进程直接连接它。也不能迁移旧库后继续运行只修改users余额的旧账务实例：双写是新代码兼容历史读写形状，不表示任意新旧写进程可同时运行。正式切换需停旧写入、迁移/导入、核对、再启动新版。

## 使用独立 V2 数据库

```bash
# 创建/重复检查独立数据库并执行全部迁移，不创建用户或复制旧数据
node scripts/database-v2.cjs prepare

# 保持.env不变，把连接只传给本次子进程
node scripts/database-v2.cjs run node apps/web/node_modules/next/dist/bin/next build apps/web

# 单独预览Web，端口避开现有服务；数据库为空时使用注册或显式初始化管理员
node scripts/database-v2.cjs run node apps/web/node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3100
```

默认开发库名stockdepth_dev，必要时通过STOCKDEPTH_V2_DATABASE_NAME指定其他名称。脚本不修改.env、不删除数据库，可对当前V2开发库重复prepare/run。prepare通过postgres维护库创建/检查目标库，并在选定开发库执行DDL。V2 run使用独立.next-v2构建目录。

不要把 `./bin/stockdepth` 或 `scripts/manage.py` 作为run的子命令：现有管理器会重新加载.env并覆盖传入连接，脚本会拒绝这种直接用法。完整服务切换需单独设置运行配置和进程状态。

## 验证

```bash
node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node apps/workers/node_modules/typescript/bin/tsc --noEmit -p apps/workers/tsconfig.json
node apps/web/node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/tests/database-v2.ts
node apps/web/node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/tests/database-integrity.ts
node --test scripts/tests/initialize-admin.cjs
node scripts/tests/isolated-regressions.cjs
```

数据库集成测试自行创建唯一命名临时库并在finally中删除，不在原库写测试数据；回归runner同样创建隔离库。Python用项目运行环境执行 test_costs.py、test_usage.py、test_multi_model_clients.py，测试不调用外部模型。

## 旧数据后续迁移

1. 在只读快照上盘点用户、积分余额、流水、模型快照、股票身份、任务和成交引用，保存迁移清单。
2. 停旧写入并取得一致性备份；按原ID导入父表/业务记录，保持引用和序列，不在导入时触发新用户赠送。
3. 为已有真实余额建立切换基线，历史流水保持未编号；迁移可证明的加密配置快照，其余明确未知。导入不调用供应商或重跑任务。
4. 验证逐表行数、内容校验、账户余额、成交金额、复合归属与引用、序列、运行中任务恢复策略；未通过前不切连接。
5. 切换新版服务到V2并观察；回退需要考虑切换后新写入，不能仅把.env改回旧库而丢失新记录。

已完成服务切换及旧数据导入，原库未修改。切换和导入前均备份双库及环境配置（本机var/backups，不提交Git），pg_restore --list校验可读。切库时刷新登录签名密钥，导入时保留新库签名密钥及管理员密码；模型密钥已校验并迁移。

当前使用标准管理命令 ./bin/stockdepth start/status/restart；管理器按照STOCKDEPTH_NEXT_DIST_DIR检查构建。Web、API、analysis、market已切换，原先停用的paper继续停用。根.env和数据库备份均不推送远程。

## 本轮验收结果

- V2真实数据库集成测试通过；原数据库完整性/升级回归通过。
- Web生产构建、Web/Worker TypeScript检查通过；Python计费/用量/双角色模型测试27项通过。
- 管理员初始化单元测试4项通过；隔离库换模、报告/用量同步、并发准入、Worker稳定性和模型可用性回归通过。稳定性覆盖两个Worker竞争只发送一次请求、租约失效、固定版本恢复和不可用身份发送前拦截。
- 当前stockdepth_dev库为V2兼容结构：30张业务表、72个已验证外键；原stockdepth仍28张表、54个外键，未执行新迁移。
- 独立V2预览检查：登录页200，未登录任务接口401，签名但不存在的用户访问任务接口401。正式切换另验证管理员鉴权和10积分账户一致；没有发送邮件或外部模型请求。
