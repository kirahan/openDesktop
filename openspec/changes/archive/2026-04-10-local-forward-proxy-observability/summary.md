# local-forward-proxy-observability

## 概述

**一句话**：新增本机 HTTP(S) **转发代理 + 规则钩子 + 观测事件管道**，补全主进程/非 CDP 的 HTTP(S) 可观测性，与现有 CDP Network SSE **模型对齐**；**首期不做 HTTPS MITM**，Phase 2 MITM 以 **tasks 第 7 组** 明确登记为后续实现。

**背景与动机**：CDP 无法覆盖 Node/主进程出站 HTTP(S)。沿 Whistle **机制**（代理 + 规则 + 可扩展管道）便于长期演进。应用级启动注入代理环境变量可避免全局代理副作用。

**影响范围**：Core/代理子进程、已注册应用模型与启动器、观测 API/SSE、Studio/Web 网络 UI；**不修改**现有 `cdp-observability-sse-streams` 主规格条文。

## 设计方案

### 改动点


| #   | 改动           | 说明                                        | 涉及文件（实现阶段）                    |
| --- | ------------ | ----------------------------------------- | ----------------------------- |
| 1   | 本地转发代理       | loopback、HTTP + CONNECT，Phase 1 不解密 HTTPS | Core 或新包，待定                   |
| 2   | 观测事件         | `source: proxy`、`tlsTunnel`，与 CDP 模型对齐    | 与 `registerObservability` 等对齐 |
| 3   | 规则（最小）       | host/path 前缀、标签                           | 代理模块内                         |
| 4   | 已注册应用开关      | 启动时注入 `HTTP_PROXY`/`HTTPS_PROXY`，非系统全局    | 应用注册 UI + 启动脚本路径              |
| 5   | Studio 展示    | 区分 cdp / proxy 来源                         | `packages/web` 等              |
| 6   | Phase 2 TODO | 根 CA、动态证书、信任、pinning                      | 仅 `tasks.md` §7，本期不写代码        |


### 关键决策


| 决策       | 选择                  | 为什么不选其他方案        |
| -------- | ------------------- | ---------------- |
| HTTPS 首期 | 仅 CONNECT 隧道，不 MITM | 信任根与合规复杂度高；分阶段交付 |
| 全局代理     | 禁止；仅进程级注入           | 降低对用户系统影响        |
| 与 CDP 关系 | 并存 + 模型对齐，不改旧 spec  | 减少规格冲突；合并展示在 UI  |


### 技术要点

- **Phase 1**：HTTPS 事件 **必须** 标明 `tlsTunnel: true`；path 可能缺失。  
- **Phase 2**（未实现）：MITM 后方可丰富 path/header/body（策略仍可与现有「无 body」SSE 边界一致）。  
- **NO_PROXY**：默认排除 localhost 与 Core 端口，防回环。

## 验收标准

> 测试与产品验收以 `specs/local-forward-proxy/spec.md` 为准。


| #   | 场景            | 操作                  | 预期结果                                     |
| --- | ------------- | ------------------- | ---------------------------------------- |
| 1   | HTTP 明文经代理    | 发起 HTTP 请求经代理       | 事件含 method、完整 URL、状态等，`tlsTunnel` 非 true |
| 2   | HTTPS CONNECT | 发起 HTTPS 经代理        | 不解密；事件 `tlsTunnel: true`；可无 path         |
| 3   | 模型对齐          | 同时存在 CDP 与 proxy 事件 | `source` 可区分，同名字段语义一致                    |
| 4   | Host 规则       | 配置 host 规则          | 命中请求带标签或等价元数据                            |
| 5   | 应用开关关         | 关闭「专用代理」启动应用        | 无代理环境变量注入                                |
| 6   | 应用开关开         | 仅应用 A 开启            | 仅 A 注入；其他应用不受影响                          |
| 7   | 默认安全          | 默认配置启动代理            | 仅 loopback 监听                            |
| 8   | NO_PROXY      | 访问本机 Core           | 不因代理回环而失败                                |
| 9   | Phase 2 未交付   | 本期验收                | **不要求** HTTPS 解密 body/path               |


## 实现清单


| #   | 任务              | 说明                       | 依赖    |
| --- | --------------- | ------------------------ | ----- |
| 1   | §1 设计与契约        | 进程模型、事件 JSON、NO_PROXY 文档 | —     |
| 2   | §2 代理核          | HTTP + CONNECT，无 MITM    | §1    |
| 3   | §3 规则层          | 最小匹配与标签                  | §2    |
| 4   | §4 应用开关与注入      | UI + 启动注入                | §2    |
| 5   | §5 Studio 集成    | 管道 + UI 来源区分             | §2    |
| 6   | §6 测试与文档        | 单测、手测、README             | §2–5  |
| 7   | §7 Phase 2 MITM | **后续变更**，本期仅 backlog     | 独立里程碑 |


## 测试要点

- CONNECT **不解密**：勿断言 HTTPS URL path。  
- 多应用开关隔离回归。  
- `NO_PROXY` 与 Core 健康检查路径。  
- **§7** 任务不参与本期 CI 完成标准。