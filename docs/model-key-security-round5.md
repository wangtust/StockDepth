# 模型密钥安全模块（第五轮 security 交付）

此文说明设计和操作顺序；本轮实际部署及16条历史配置加密已经 coordinator 验收，详见 [第五轮结果](optimization-results-round5-2026-10-12.md)。独立新环境仍须先安全配置自身密钥，不能复制或输出生产材料。

`apps/web/lib/security/model-key.ts` 使用 AES-256-GCM，随机 12-byte nonce、16-byte tag。文本信封为 `sdkey:v1:<key-id>:<nonce>:<ciphertext>:<tag>`，二进制采用规范 base64url。AAD 包含用途、版本和 key ID。保留 `sdkey:` 前缀，损坏或未知版本不能回退成明文。旧明文双读用于分阶段上线，新 setter 必须加密；缺失密钥、错误认证、未知 ID 均返回固定错误，不携带配置值。管理员只收到 `configured`/`not set`。

独立环境设置：`STOCKDEPTH_MODEL_KEY_ID` 为当前写 key ID；`STOCKDEPTH_MODEL_KEYRING` 为 JSON 对象，key ID 映射到 32-byte 随机密钥的无填充 base64url。不使用模型 API key 或 AUTH_SECRET 派生，不把解密材料存数据库。环境由运维安全生成/保存，`.env` 权限600，保留原设置，禁止打印、提交或同密文一起导出。轮换时先给所有 reader 加入新 key，保留旧 key，再切换写 ID；不得自动删掉仍有历史密文依赖的 key。

读取清单：Web 默认配置 getter；管理员列表仅返回遮掩状态；Web connection probe 在 stdin 前解密且不把 keyring 传给 Python 子进程；analysis worker 按任务指定配置取 key、在 API start 请求前解密；paper worker 默认配置 getter 解密。Python API/provider 接收的是调用时明文，不直接读取模型配置数据库；不得把它写入日志或持久配置。无密钥的分析列表/报价 DTO 无需解密。旧 SQL 迁移只复制列值，没有新增生产明文迁移步骤。

保护的 `admin/actions.ts` 保存路径需要 coordinator 合并 `var/codex-team-round5/frontend.admin-actions.required.patch`。补丁相对原未提交内容生成，保留 `use server` 指令和原价格校验/表单改动；先检查加密配置，再进行原 connection probe，create/update 只写信封，更新时未输入 key 保留原值。`model-create-form.tsx` 无必要改动。该补丁已由 coordinator 合入；Git index 仅包含加密必要改动，原表单修改继续留在工作树。

部署顺序：先合并 setter 补丁并完成全套隔离库/HTTP/worker/build 验证；coordinator 安全生成独立 key 并确认所有读取进程有效加载兼容 reader 和 keyring；按安全空闲条件部署/重启；最后显式执行历史加密工具。读写代码已经兼容明文时，无需提前修改数据库列或先加密生产。迁移前禁止启动真实配置连接测试或付费模型。

工具通过已有运行环境供给 `POSTGRES_URL`，不自行读取 dotenv：

- `scripts/model-key-migrate.ts` 默认事务 READ ONLY dry-run，报告数量并预检解密/加密；`--apply` 还要求 `STOCKDEPTH_MODEL_READERS_READY=true`，由 coordinator 实际核验后设置。逐行锁定，整笔事务写，重复执行无变更；空 key 配置没有秘密，保持未设置并仅计 unset 数量；`--rotate` 仅重写旧 ID。损坏/缺 key 整笔失败。保留所有旧解密材料，无明文 dump 或值日志。
- `scripts/round5-asset-audit.sql` 使用 REPEATABLE READ READ ONLY，现金流水、数量流水、金额、归属引用、成交 quote 和未验证约束只输出数量。差异须人工核验初始持仓/现金历史等原因，不自动修复或 VALIDATE；不声称能从流水完整重建成本舍入。
- `scripts/market-retention.ts` 永远 dry-run，`--apply` 拒绝。90天前、非最新且无成交引用/活动租约的报价，以及已结束无活动租约的老同步审计仅计候选数。所有幂等记录、日线、未结束同步记录保留。生产自动清理关闭；将来删除实施必须另外设计、在独立库验证引用/并发保护后再审查。

测试只用内存合成密钥：`round5-security.ts`；`round5-security-readers.cjs` 运行真实 reader/调用源码的 mock；`round5-security-db.ts` 硬断言 127.0.0.1:55485 和新 `stockdepth_round5_security_<timestamp>` 数据库；`round5-security-admin-patch.cjs` 默认测试实际 actions，交付前可用 `ROUND5_ADMIN_ACTIONS_SOURCE` 指向 review candidate。没有网络模型请求。DB 测试只创建合成夹具，不执行共享迁移；coordinator 仍需全 schema、新旧库与完整集成验收。
