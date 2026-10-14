# CI troubleshooting — Phase 0

无run时先确认dev push SHA与路径触发条件，用GitHub connector GET repository actions/runs（branch=dev），不能使用PR-only commit wrapper或以push成功当验收。本机gh无认证不妨碍已授权connector读取；访问拒绝记录external_access，不反复返修。

失败读取实际job/steps/logs，交回文件owner；锁双文档、Python无锁、历史var输入、浏览器绝对路径、pnpm内部路径、根env加载均是后续复现风险。不要删除断言、忽略退出码或访问应用DB。业务缺陷等待授权。rollback只撤销对应workflow/文档/已授权bootstrap增量，不能reset整个工作区。
