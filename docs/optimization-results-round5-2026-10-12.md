# 2026-10-12 第五轮数据库可靠性与敏感配置验收

前置 main 为已验收并推送的第四轮 `9d3115a7ae2267cee79f2432ad6e8f18bd473da8`。coordinator 完整阅读计划、第四轮结果及两份最终 checkpoint/handoff 后独立审查、整合、回归、部署。没有启动额外 agents，没有使用 reset/stash/checkout、全局格式化、force push、收费模型或真实资产下单。原表单改动保留；生产历史未删除。

## 已部署范围

10 个资产 cents 列改为 PostgreSQL bigint；服务端中间乘加、成本舍入和损益累计使用 BigInt。现有 API 金额仍为 number，必须落在 ±9007199254740991 分内。驱动先精确解码和检查，再转 number；超界明确拒绝，GET /api/paper 和分析上下文超界返回422，分析超界在扣积分/排队前拒绝。交易最终现金/单笔金额/累计损益超界回滚；内部估值乘积可以更大。初始化与手动价格采用 decimal half-up，包括 1.005→101。数量、ID和原请求上限仍受限制，Token及费用 numeric 未改。

新增6个复合唯一索引、10个复合归属外键和10个安全范围 CHECK。索引包含原主键，不限制同用户合法多组合。新约束全部 NOT VALID，约束新写入并保留旧异常；原3个未验证 CHECK 继续保留，生产共23个未验证约束。没有自动 VALIDATE、修复或清洗。迁移只改金额类型，不重写价格/数量/现金/时间戳；成交快照触发器的 cents cast 同步扩为 bigint。原 user→portfolio→decision→有序positions 锁、事务重读、不可变 quote 引用、持久重放保持。

模型 API Key 使用版本化 AES-256-GCM 信封，独立随机环境密钥、nonce和用途/版本/ID认证。支持旧明文双读和保留旧ID的轮换；损坏、未知版本/ID或缺key固定失败。管理员仅获 configured/not set，默认getter、probe、analysis指定配置及paper默认配置均兼容解密。probe子进程不继承keyring。新增/更新只保存密文，空更新保留旧值，加密配置不可用时在原模型探测前返回错误。

coordinator 另修补完整新库发现的兼容缺口：历史空key是未配置状态，迁移保持空值并只计unset；不把它强行加密或因此阻断其他配置。独立迁移默认 READ ONLY dry-run，显式apply需要实际reader就绪，整笔原子、重复幂等、仅数量输出。未产生明文dump，未使用真实key验证模型连接。

历史审计仅只读。保留工具默认且强制dry-run，apply拒绝；候选排除成交引用、每股票最新报价和活动租约，保留全部幂等结果、日线及未结束同步审计。没有生产自动清理。

## 独立验收证据

日志及原始失败均保存在忽略目录 `var/codex-team-round5`，每步 checkpoint/handoff 持久更新。

| 检查 | 最终结果 |
| --- | --- |
| 交易、锁、并发、回滚、重放、金额边界 | coordinator-trade.log：31/31，包含第三轮24项原安全断言、旧int4边界以上、MAX_SAFE正负上界、风险大乘积、AI真实quote引用/不可变保护、10项跨归属拒绝与同用户第二组合 |
| 精确上下文、enqueue422、真实Worker建议价 | coordinator-context.log：5/5；无积分/任务写入，最终已合入Worker补丁 |
| 迁移矩阵、旧资产逐行、异常保留 | coordinator-migration.log：29→30、26→30、0→30及重复，10bigint/20新NOT VALID；旧错归属和负值保留，事务重读仍拒绝异常 |
| 真实初始化及重复 | coordinator-init.log：全30迁移/23表/0用户；禁用所有dotenv路径 |
| 加密、全部reader、管理员写入 | coordinator-security/readers/admin.log：24合成加密检查、真实源码mock路径、认证损坏/未知版本/缺key在请求前失败；未调用模型 |
| key迁移、轮换、回滚与保留 | coordinator-security-db-final.log：独立55485合成库dryrun/apply/repeat/旧key轮换/整笔损坏回滚及引用/最新/租约/重放保护 |
| 全schema加密与管理员真实HTTP | coordinator-security-http-final.log：全30迁移库含空key，dryrun/apply/repeat、空值保留、缺key失败、已构建admin页面不泄露key/密文 |
| 第四轮目录、行情、Worker、租约 | coordinator-market-accepted.log：24/24，含两真实mock Worker、26秒心跳、过期fencing、260日线批量/精确重复修订；只适配3处原SQL cents断言为字符串 |
| 私有已构建服务及隐藏/恢复权限 | coordinator-private-http/visibility.log：签名会话、匿名/停用拒绝、共享DTO、组合隔离、新增去重、交易重放、分析排队、管理员暂停、GET不改state；隐藏/恢复/报告保留；无Worker/model调用 |
| 前端HTTP/HTTPS、类型及build | 第三轮HTTP和HTTPS显式重试生命周期、第四轮行情前端通过；web/worker类型通过；coordinator-fullbuild-release.log完整Next编译/类型/28页面/traces通过 |
| Token、费用及恢复 | coordinator-token14.log：5+6+3共14项本地合成测试，无网络模型请求 |
| 部署后真实只读HTTP | paper/analysis/market/admin日志：原金额number契约、用户隔离、积分、历史Token/calls/report/公开费用、股票页与有界DTO、管理员仅状态均通过 |

原第四轮测试不改。bigint后原SQL字符串与number断言不匹配、试图全局解码bigint误改日线volume断言、mock库名不符合原严格前缀的失败均保留；最终复制测试只改3处cents预期，仍用原55483/round4库名前缀，不弱化生产mock安全条件。隔离build初次缺Stripe占位失败，补合成占位后完整通过；最终build不读取生产.env。完整schema测试发现空key阻断迁移的失败保留并已修补复验。没有把失败算通过。

所有写回归硬断言私有地址/端口/新库名；金额和行情在55483，合成安全库在55485。真实HTTP写入前有数据库canary。生产仅执行授权的schema/key迁移，没有模拟下单或历史删除。

## 实际部署及资产不变

先独立只读生产baseline：1组合/3持仓/4成交，10项归属引用审计异常0。资产 cents规范字符串哈希为 `c9dac8f51dc4987ebb10f3ef406cd9441f570b4bd1f7c85e908784ce5bdc74ca`；额外记录全部原资产字段与时间戳哈希 `b63216d254541793dc5602954478dbe757d5d217664f018f4931b06fb9d7d774`。金额迁移后及最终部署/加密后，两者逐次相同、原counts相同。这使用第五轮一致的cents规范化格式，不拿第四轮raw-number哈希冒充相同格式。

独立随机key安全保存根.env，权限600，原值保留、无输出、无Git。多次数据库队列/运行决策/可领取paper均0，API活跃runs0，读取进程无非数据库出站请求，才安全重启。生产29→30迁移使用统一advisory lock、5秒锁超时/60秒语句超时；部署完整已测试build后启动原已运行的web/analysis/paper，旧进程组确认退出。最终web289302、analysis289333、paper289354；原API74488、market268061不变，没有启动原未运行收费服务。

每个数据库keyreader验证新PID/兼容源码/实际环境keyring一致和预检后，才执行历史加密：16配置，dryrun候选16、apply16、repeat候选0；16全部密文，三个reader各自加密后解密预检成功。Python API不读数据库key，只接受调用时payload，无需轮换keyring或重启。管理员真实只读页面再次验证密文和解密key都不输出。

最终只读资产SQL审计现金流水、数量流水、金额/现金合法性、归属与quote引用异常均0，23个NOT VALID保留。行情正常异步增长：最终样本44快照/4500日线/68同步审计/0重放；retention候选报价/审计均0且automaticCleanup=false。没有宣称磁盘恒定或所有股票都有有效报价。

## Git与局限

仅本轮源代码、迁移、合成测试、计划/结果/安全说明及README/.env.example入scope。actions.ts以HEAD构建仅必要加密index内容，并独立测试该版本；原未提交safeParse/事务审计表单内容继续留工作树，model-create-form.tsx完全不变。var、真实.env、密钥及原无关hunks均不提交。fetch后确认远程main与前置HEAD一致；最终提交/推送及remoteSHA=HEAD记录于coordinator checkpoint并在最终回复报告，不force。

本轮功能和生产部署已验收，无遗留生产key加密待办。保守范围仍包括JSON安全金额上界、NOT VALID历史约束、无真实模型调用验证、无生产key轮换演练、无生产历史删除、无外部生产HTTPS端到端证书验证（HTTP/HTTPS浏览器安全上下文已测）。第四轮供应商/交易日历/全市场覆盖限制继续成立；没有延伸财报、新闻或全市场行情。
