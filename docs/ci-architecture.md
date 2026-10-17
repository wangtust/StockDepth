# CI architecture

当前实现与验收：[完整记录](ci-completion.md)。统一 `.github/workflows/ci.yml` 在 main/dev push、目标 main/dev PR 及手动操作时运行，contents:read；不使用 pull_request_target，不注入生产 secrets。

Type checks、Python offline tests、Frontend regression 三组、Web production build、Security regression、Dependency audit、Secret scan 独立运行；Database integration 调用 integration.yml，在独立 PostgreSQL16 service 上运行8组随机库测试。最终 CI required 只接受所有依赖 success；矩阵不 fail-fast，以保留全部诊断。PR 不做 paths 过滤，避免门禁等待未触发的检查。

setup-ci composite 固定 Node22/Python3.11 与根 packageManager，按 node/python 分别安装 frozen/hash 依赖。缓存仅下载/store；不缓存 node_modules、venv 或应用数据。所有官方 action 固定提交 SHA；Gitleaks 下载固定版本并校验 SHA256。所有 job 有超时，同事件同 PR/ref 取消旧运行。

浏览器只运行本地合成 HTTP 与组件夹具；Python socket 离线限制；构建使用合成配置；DB仅CI角色、动态映射端口及临时库。Python JUnit、前端/安全/DB JSON artifact 保留7天，缺报告失败。旧 phase0/phase1 仅保留手动入口。

真实生产部署使用项目管理器和真实配置，与合成 CI build 分开；本轮已在空闲窗口发布并完成只读检查。历史 Phase1/2 证据保存在 [results](ci-results.md) 与 [第二阶段记录](ci-phase2-execution.md)。
