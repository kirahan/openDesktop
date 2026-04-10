## ADDED Requirements

### Requirement: 本地 HTTP(S) 转发代理（Phase 1，非 MITM）

系统 SHALL 提供 **本地 HTTP(S) 转发代理** 能力，监听 **loopback** 地址上的 TCP 端口，并处理 **HTTP 请求** 与 **HTTPS CONNECT** 隧道。在 **Phase 1** 中，系统 **MUST NOT** 对 HTTPS 执行 **TLS 终止或 MITM 解密**；对 HTTPS 的观测 **SHALL** 仅限于代理层在不解密条件下可得的元数据（例如隧道目标 host:port、连接时序、字节计数等），且 **SHALL** 在事件中携带 **`tlsTunnel: true`**（或等价机读字段），以免消费者将缺失的 path 误解为数据错误。

#### Scenario: HTTP 明文请求可被观测

- **WHEN** 客户端经本代理发起 **HTTP**（非 TLS）请求
- **THEN** 系统 **SHALL** 产生至少包含 method、完整 URL（或 scheme/host/path）、状态与时间信息的观测事件，且 `tlsTunnel` **SHALL** 为 false 或省略（与实现约定一致并在文档说明）

#### Scenario: HTTPS 经 CONNECT 且不解密

- **WHEN** 客户端经本代理发起 **HTTPS**（CONNECT 隧道）
- **THEN** 系统 **SHALL** 建立隧道并转发流量，且 **SHALL NOT** 解密 TLS 载荷
- **THEN** 观测事件 **SHALL** 标明隧道属性（`tlsTunnel: true`），且 URL 中 **MAY** 仅包含 scheme、host、port 而无 path

### Requirement: 与 CDP 网络观测事件模型对齐

系统 **SHALL** 为代理来源的观测事件定义 **canonical 字段集**，与现有 CDP Network / network SSE 所用模型 **对齐**（同一字段语义、可合并展示）。每条事件 **SHALL** 包含 **`source`** 字段，取值为 **`proxy`**，以便与 **`cdp`** 来源区分。

#### Scenario: 合并展示不混淆来源

- **WHEN** Studio 或消费者同时接收 CDP 与代理两类事件
- **THEN** 消费者 **SHALL** 能依据 `source` 区分来源，且同一字段名在不同来源下语义一致

### Requirement: 规则层（最小实现，可扩展）

系统 **SHALL** 提供 **规则匹配钩子**（首期最小实现即可），至少支持基于 **请求目标 host**（及可选 **path 前缀**）的匹配，并产生 **可观测动作**（如记录、附加标签）。系统 **MAY** 将完整 Whistle 式脚本规则留待后续变更实现。

#### Scenario: Host 规则命中

- **WHEN** 管理员或配置已为代理配置某 host 匹配规则
- **THEN** 匹配到的请求 **SHALL** 在观测事件中携带对应 **标签**（或等价元数据）

### Requirement: 已注册应用级代理开关与非全局注入

系统 **SHALL** 在 **已注册应用** 的配置中提供 **「启动时使用专用代理」**（或等价命名）开关。当开关为 **开启** 时，系统 **SHALL** 仅在该应用 **启动流程** 中向该应用进程（及其子进程继承环境）注入 **`HTTP_PROXY`** 与 **`HTTPS_PROXY`**（指向为本应用或本会话分配的 loopback 代理地址）。系统 **MUST NOT** 将上述设置作为 **操作系统全局代理** 写入系统设置。

#### Scenario: 开关关闭无注入

- **WHEN** 该应用开关为 **关闭**
- **THEN** 启动流程 **SHALL NOT** 注入上述代理环境变量（与未实现本功能时行为一致）

#### Scenario: 开关开启仅影响该应用

- **WHEN** 应用 A 开关开启而应用 B 关闭
- **THEN** 仅应用 A 的启动环境 **SHALL** 包含代理变量；应用 B **SHALL** 不受影响

### Requirement: 默认安全与回环防护

代理 **SHALL** 默认仅监听 **127.0.0.1**（或等价 loopback）。系统 **SHALL** 为注入场景提供 **NO_PROXY** 默认策略，至少排除 **localhost**、**127.0.0.1** 及 **OpenDesktop Core 服务端口**（或等价配置），以避免代理回环与自调用故障。

#### Scenario: 默认监听不可被局域网直接访问

- **WHEN** 代理在默认配置下启动
- **THEN** 监听地址 **SHALL** 限制为 loopback，除非显式高级配置另行允许（若支持）

### Requirement: Phase 2 MITM（HTTPS 解密）— 规范占位

系统 **SHALL** 在架构上为 **Phase 2** 保留 **MITM 解密 HTTPS** 的扩展点（根 CA、动态证书、按规则选择解密或隧道）。本变更 **SHALL NOT** 将 MITM 作为已交付行为；该能力 **SHALL** 在后续变更中通过 **独立规格增量** 追加 **MODIFIED/ADDED Requirements** 实现。当前阶段 **SHALL** 仅在设计与任务清单中维护 **TODO**，说明 **若无 MITM，则无法获得 HTTPS 明文 path/header/body 级信息**。

#### Scenario: 本期验收不依赖 MITM

- **WHEN** 执行本变更的验收测试
- **THEN** **SHALL NOT** 要求成功解密任意 HTTPS 请求体或 URL path（除非为 HTTP 明文）
