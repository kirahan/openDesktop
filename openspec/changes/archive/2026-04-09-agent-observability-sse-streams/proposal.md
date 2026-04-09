## Why

现有 `network-observe` 与 `runtime-exception` 均为 **POST Agent action + 有界时间窗口** 的一次性采样，适合脚本与 Studio 按钮，但不适合「长时间 tail」调试。仓库中 **控制台** 已采用 **`GET` + SSE**（`/v1/sessions/:sessionId/console/stream`）先例；网络与异常栈应对齐该模式，并在 **网络侧显式限流**，避免 CDP 事件洪峰拖垮 Core 或撑爆客户端。

## What Changes

- 新增 **经鉴权** 的 SSE 端点（路径与 query 约定在设计中固化），用于：
  - **HTTP(S) 网络事件流**：在订阅建立之后持续推送该 target 的可观测请求元数据；**不**声称回放连接建立前的历史（与控制台流一致）。
  - **运行时异常栈流**：在订阅建立之后持续推送未捕获异常及栈帧（语义与现有 `runtime-exception` action 对齐）；须 **`allowScriptExecution`** 时方可建立（与现有 action 403 规则一致）。
- 为 **网络 SSE** 定义 **数据量防护**：包括但不限于并发连接上限、事件速率/条数上限、可选采样或合并策略、超限时的可机读信号（如丢弃计数、`event: warning` 或字段内 `dropped`），具体阈值由实现文档化并在 spec 中约束「SHALL NOT 无提示静默丢光」类行为。
- 为 **异常栈 SSE** 定义相对轻量的上限（如每秒异常数、并发流数量），防止恶意或故障页面刷屏。
- 保持现有 **POST `network-observe` / `runtime-exception`** 行为 **不变**（非 BREAKING）；新版本能力为 **附加**。
- **可选（非本变更阻塞）**：Studio Web 增加连接/断开与只读展示；CLI 可用 `curl -N` 消费 SSE。

## Capabilities

### New Capabilities

- `cdp-observability-sse-streams`：定义网络与运行时异常两类 SSE 的契约（鉴权、会话/CDP 前置条件、`ready`/`error` 事件形状、无历史、断开即释放资源）；网络流专项 **规模与背压** 要求；异常流与 `allowScriptExecution` 关系。

### Modified Capabilities

- （无）根目录既有 `cdp-network-observability` 与 `studio-live-console` 的 **POST/短时** 与 **控制台流** 要求保持不变；本变更通过 **新 capability** 追加 SSE 行为，避免混淆「窗口聚合 action」与「长连接流」。若后续需要将能力统一归档到根 `openspec/specs/`，可在 archive 阶段再合并。

## Impact

- **代码**：`packages/core` HTTP 路由（`createApp` 或 observability 注册模块）、CDP 订阅与清理、与 `consoleStreamLimiter` 类似或复用的 **流并发限额**、网络侧 **速率/条数** 模块；HTTP 测试。
- **API**：新增 `GET` SSE（需写入 `GET /v1/version` 或等价可发现字段，若项目惯例包含 `observabilityStreams` / 文档链接——在设计中明确）。
- **Studio**：可选 UI；不阻塞 Core 契约落地。
- **安全**：长连接与网络元数据仍须遵守现有审计与 URL 脱敏思路；网络流默认 **不** 传 body。
