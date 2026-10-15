# 每日数据库副本同步

本机 `POSTGRES_URL` 是主库；`120.76.53.3:5432/stockdepth` 是专用备份库。
目标连接默认复用本机数据库用户名和密码，不需要在配置中复制密码。
备份库会被整库同步覆盖，不应承接独立业务写入。

## 配置

根 `.env`：

```dotenv
DATABASE_SYNC_HOST=120.76.53.3
DATABASE_SYNC_PORT=5432
DATABASE_SYNC_DATABASE=stockdepth
DATABASE_SYNC_RETENTION_DAYS=14
```

配置以下任一安全连接方式。

### 验证 PostgreSQL TLS 证书

通过可信渠道取得远端数据库的 CA/自签名证书（公钥证书，不是私钥），配置：

```dotenv
DATABASE_SYNC_SSLROOTCERT=/absolute/path/to/trusted-server-ca.crt
```

远端证书还需能验证目标 IP；如证书只签发给域名，应使用证书匹配的目标域名。
直连固定使用 `verify-full`，不会自动接受未验证的自签名证书。

### SSH 隧道

已设置密钥登录和可信 `known_hosts` 时配置：

```dotenv
DATABASE_SYNC_SSH_USER=your-ssh-user
DATABASE_SYNC_SSH_HOST=120.76.53.3
DATABASE_SYNC_SSH_PORT=22
DATABASE_SYNC_SSH_KEY=/absolute/path/to/private-key
```

脚本只把密钥路径交给 SSH，不读取或输出私钥；要求 BatchMode 和严格主机密钥校验。
数据库连接通过已验证的加密 SSH 隧道到远端 `127.0.0.1:5432`，不需要公开数据库端口。

## 首次执行

```bash
./bin/sync-database --check
./bin/sync-database
```

`--check` 仅检查版本、连接和表数量，不写远端。
同步使用匹配主库版本的 `pg_dump`/`pg_restore` 和 `psql`；目标 PostgreSQL 主版本不得低于主库。
用户需要目标库 schema 的删除/重建权限；本项目仅允许 public、drizzle 两个应用 schema。
发现额外 schema 或扩展时停止，避免影响其他应用。

每次同步：

1. 本机一致性导出为 custom archive。
2. 完整导出目标库现状；备份失败即停止，不发送删除语句。
3. 将源库结构/数据转换成 SQL，在目标库单个事务中删除旧应用 schema 并完整恢复。
4. SQL 失败由 PostgreSQL 回滚；恢复成功后检查表数量，保存 SHA-256 清单。
5. 成功后清理超过保留天数的本脚本备份。

主库不执行删除和还原。备份存于 `var/database-sync/`，目录 0700、文件 0600，受 Git 忽略。
密码只通过子进程环境传递，不进入命令行和日志。同步锁防止任务重叠。

## 定时执行

模板在 `deploy/systemd/stockdepth-database-sync.service` 和 `.timer`。
默认每天北京时间 03:00（显式 Asia/Shanghai，不依赖服务器系统时区）。
安装前核对模板中的项目绝对路径及 Linux 用户，并确认手动同步成功。

```bash
sudo install -m 644 deploy/systemd/stockdepth-database-sync.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/stockdepth-database-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stockdepth-database-sync.timer
systemctl list-timers stockdepth-database-sync.timer
journalctl -u stockdepth-database-sync.service
```

开启 Persistent 后，错过的定时任务会在机器再次启动时补执行。
服务失败会记录在 journal，定时器下次仍会再次执行。手动重试：
`sudo systemctl start stockdepth-database-sync.service`。

## 恢复材料

每次包含 source dump、target-before dump、manifest；恢复命令应先在独立测试库验证。
数据库内模型 API Key 是加密值，若未来将远端提升为业务主库，还需安全分发原来的
模型 keyring 等应用配置；脚本不会复制 `.env` 或密钥。

测试：`/path/to/runtime/bin/python scripts/tests/test_database_sync.py`。
使用独立临时本机数据库验证完整恢复和事务回滚，结束后删除测试库，不访问远端。
