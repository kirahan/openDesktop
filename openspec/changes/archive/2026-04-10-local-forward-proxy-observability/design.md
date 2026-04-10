## Context

OpenDesktop 已通过 **CDP Network** 与 **GET …/network/stream**（SSE）覆盖**页面 target** 维度的 HTTP(S) 元数据观测。主进程及未走 CDP 的 HTTP(S) 需要另一条**显式经代理**的通道。业界 **Whistle** 采用「本地代理 + 规则脚本 + WebUI」的可扩展形态；本设计沿用该**机制分层**（代理核、规则、观测管道可演进），但实现上 **复用自研/选型库**，不强制嵌入 Whistle 发行包。

约束：**首期不实现 MITM 解密 HTTPS**；须在文档与代码注释中保留 **Phase 2 MITM** 的明确 TODO，否则无法获得与 DevTools 类似的 HTTPS **path/header/body** 级信息。

## Goals / Non-Goals

**Goals:**

- 提供 **本机 HTTP(S) 转发代理**（默认仅监听 loopback），处理 **HTTP** 与 **HTTPS CONNECT**。
- **首期（Phase 1）**：对 HTTPS **不终止 TLS**；对经代理可见的信息形成 **canonical 观测事件**（与现有 CDP 网络事件模型对齐，含 `source: proxy`），进入与 Studio 集成的管道。
- 提供 **规则层扩展点**（最小实现即可：如按 host/path 匹配 → 记录/丢弃/打标签），与后期 Whistle 式规则对齐。
- **已注册应用**维度：**开关打开时**仅在**该应用启动**过程中注入 **进程级** `HTTP_PROXY`/`HTTPS_PROXY`（及可配置的 `NO_PROXY`），**不设置操作系统全局代理**。
- 在 **design / tasks** 中列出 **Phase 2 MITM**：根 CA、按域名动态证书、信任引导、pinning 失败降级 —— **仅 TODO，不写生产路径**。

**Non-Goals（首期）：**

- 安装/信任 **用户态根证书**、HTTPS **中间人解密**、HTTPS **明文 body** 捕获。
- 替代用户系统 VPN/透明代理；强制全局流量改道。
- 非 HTTP(S) 协议（gRPC-over-HTTP2 若走 CONNECT 可再议，首期不展开）。

## Decisions

### D1：两阶段交付边界

| 阶段 | 内容 |
|------|------|
| **Phase 1（本变更实现）** | 代理监听、HTTP 转发、CONNECT 隧道、可观测元数据、规则钩子（最小）、应用级启动注入、事件模型对齐、Studio 消费接口占位或实现 |
| **Phase 2（后续变更，本文档 TODO）** | 本地根 CA、动态签发、MITM 握手、信任 UI、按 host 规则选择「解密 / 仅隧道」、pinning 检测与告警 |

**理由**：MITM 涉及信任根与合规，独立里程碑可降低首期风险；CONNECT 仍可提供 **host:port、时间线、字节计数** 等，对主进程排障已有价值。

### D2：与 CDP 网络事件「模型对齐」

- 定义 **统一 canonical 字段**（与现有 `NetworkRequestRow` 或 Core 已有 JSON 对齐）：如 `id`、`method`、`url` 或 scheme/host/path、`status`、`timing`、`source`（`cdp` \| `proxy`）。
- **Phase 1** 对 HTTPS：若无 MITM，`url` 可能仅 **scheme + host + port**（path 不可得），**SHALL** 在事件中显式 `tlsTunnel: true` 或等价字段，避免 UI 误解。
- **Phase 2**：MITM 后 **SHALL** 填充 path/query 及扩展头信息（仍 MAY 不传输 body，与现有 SSE 边界一致）。

### D3：代理进程归属与端口

- **推荐**：代理与 **Core 同机**、由 Core 或专用子进程拉起，端口 **动态分配** 或 **每 session / 每 app 注册表项** 配置；具体选型在实现任务中定稿。
- **必须**：仅 bind **127.0.0.1**（除非显式高级配置），降低局域网暴露面。

### D4：已注册应用开关语义

- 开关 **仅影响** 该应用下一次启动注入的环境变量；**不** retroactive 影响已运行进程。
- **NO_PROXY**：默认包含 `127.0.0.1,localhost` 及 Core 自身端口，避免 **代理回环**。

### D5：规则引擎（Whistle 向）

- **首期**：内置极简规则（如 glob/前缀匹配 host），动作为 `observe` | `passthrough` | `tag:<string>`；脚本插件 **不** 作为首期交付。
- **后期**：与 Whistle 类似的 **脚本规则** 通过插件接口接入（独立变更）。

### D6：Phase 2 MITM — 实现备忘（TODO，非本期代码）

以下 **不得** 在本期合并为可执行路径，**须在 `tasks.md` 中单列「后续里程碑」任务**：

1. 生成 **开发用根 CA**（密钥离线保存策略）。
2. **每域名** 动态叶子证书（SNI、证书缓存、有效期）。
3. **跨平台信任引导**（macOS Keychain / Windows 证书管理 / Linux）。
4. **上游 TLS 校验**与 **客户端 MITM TLS** 分离；**Certificate Pinning** 失败时 **事件告警** + 回退隧道。
5. 与 **安全红线**：根证书仅标记为 **开发/本机** 用途，**禁止** 静默安装到生产用户机器（需显式用户动作）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| HTTPS 无 MITM 时信息稀疏 | UI 与事件字段标明 `tlsTunnel`；文档引导 Phase 2；HTTP 明文仍全量元数据 |
| 应用忽略 `HTTP_PROXY` | 文档列出；后续提供 `NODE_OPTIONS` 注入或专用 SDK 钩子（另案） |
| 代理回环 / 自调用 | 默认 `NO_PROXY` + Core 端口排除 |
| 多应用多代理端口 | 启动器传不同 `HTTP_PROXY` 端口或统一代理内按 env 区分（后续优化） |

## Migration Plan

- 新能力 **默认关闭**（应用级开关未开启则无行为变更）。
- 关闭开关后下次启动不注入代理环境变量。

## Open Questions

- 代理事件进入 Studio 的 **传输方式**（复用 SSE、独立 WebSocket、或仅 CLI）：实现阶段结合现有 `registerObservability` 再定。
- 与 **Bearer / Session** 绑定粒度：事件 **仅本机** 还是需 **与 sessionId 关联**（推荐关联，便于多会话隔离）。

## References（机制对齐，非依赖声明）

- Whistle：规则与插件扩展思路参考 [avwo/whistle](https://github.com/avwo/whistle)。
- 现有 CDP 网络 SSE 规范：`openspec/specs/cdp-observability-sse-streams/spec.md`。
