## Context

- Core 已提供：`POST /v1/agent/sessions/:id/actions` 下的 `network-observe` 与 `runtime-exception`（有界窗口）；`GET /v1/sessions/:sessionId/console/stream`（SSE）与 `consoleStreamLimiter`（并发上限 8）。
- 网络 CDP 事件量可能远大于控制台；异常栈通常稀疏但仍需防刷屏。
- Studio 与 CLI 需要与控制台一致的「连接即订阅、断开即停」心智。

## Goals / Non-Goals

**Goals:**

- 为 **网络元数据** 与 **运行时异常+栈** 提供 **GET + SSE**，语义与 `console/stream` 对齐：`ready` 后仅推送 **订阅建立之后** 的事件；客户端断开则 **Abort** CDP 侧监听并释放并发名额。
- 网络流实施 **可文档化的多层级限制**（并发、速率、条数、可选 URL 长度截断），超限行为 **可机读**（不得静默丢光且无提示）。
- 异常流实施 **并发上限** 与 **合理的事件率上限**（明显低于网络侧阈值即可）。
- `runtime-exception` SSE 在会话 **`allowScriptExecution === false`** 时返回 **403**，与现有 action 一致。
- 补充 **可发现性**：`GET /v1/version` 增加可选字段（例如 `sseObservabilityStreams: string[]` 或固定文档 URL），列出新增路径模板，便于客户端探测。

**Non-Goals:**

- 不在本变更中要求 **Studio Web** 必须实现完整 UI（可后续变更）。
- 不在 SSE 中传输 **request/response body**（与现有 network-observe 边界一致）。
- 不提供 **历史回放**（连接建立前的 DevTools 缓冲不承诺）。

## Decisions

### 1. 路由形态

- **选择**：在现有 `v1` 会话命名空间下新增两条 GET，与 `console/stream` 并列，例如：
  - `GET /v1/sessions/:sessionId/network/stream?targetId=...`（名称以最终实现为准，须在 spec 与 version 可发现字段中一致）
  - `GET /v1/sessions/:sessionId/runtime-exception/stream?targetId=...`
- **理由**：与 `console/stream`、`logs/stream` 同一鉴权与中间件习惯；避免塞进 `agent/actions` POST。
- **备选**：挂在 `/v1/agent/...` 下——与「非 action 的 GET」先例不一致，弃用。

### 2. 网络 SSE 背压策略

- **选择**：组合策略（实现可配置常量）：
  - **全局/类级并发上限**（独立于控制台计数器，避免与 `MAX_CONCURRENT_CONSOLE_STREAMS` 混用，或采用「总 SSE 观测流」统一配额——二选一在实现时取更简单者并文档化）。
  - **事件速率上限**（如每秒最大推送条数或 token 桶）；超限事件 **丢弃并累计** `droppedEvents`（或等价），并通过 SSE `event: warning` 或周期性 `data` 心跳携带统计，满足「有提示」。
  - **单条 payload 大小上限**（URL、方法等字段截断与现有 network-observe strip 策略对齐）。
- **理由**：纯阻塞会反压 CDP 并拖死浏览器；纯无界丢弃违反可观测性信任。
- **备选**：仅降采样（随机丢）——难以向用户解释，作为次要选项与计数丢弃并存时可接受。

### 3. 异常栈 SSE 限制

- **选择**：独立并发上限（可与控制台共用「观测类流」总池或单独常量）；可选 **每分钟最大异常条数** 后带 `warning`。
- **理由**：流量特征与网络不同，不宜共用同一速率桶。

### 4. CDP 实现位置

- **选择**：在 `packages/core/src/cdp/` 新增或扩展模块（如 `networkStream.ts`、`runtimeExceptionStream.ts`），由 `createApp` 或 `registerObservabilityRoutes` 注册；模式复用 `runConsoleMessageStream`（AbortSignal、错误写 `event: error`、结束 `res.end()`）。
- **理由**：与现有分层一致，便于单测 mock CDP。

### 5. 版本可发现性

- **选择**：扩展 `GET /v1/version` JSON，增加例如 `sseObservabilityStreams: ["network", "runtime-exception"]` 或完整 path 模板数组（实现择一并与文档一致）。
- **理由**：客户端无需硬编码路径。

## Risks / Trade-offs

- **[Risk] 网络洪峰仍可能导致进程 CPU/内存升高** → 严格速率限制 + 连接数上限 + 可选按 URL 合并（若后续需要另提案）。
- **[Risk] SSE 在部分反向代理下缓冲** → 文档说明需关闭缓冲或使用支持 SSE 的代理；与控制台流相同。
- **[Risk] 与短时 `network-observe` 语义重叠** → 在文档与 UI 文案中区分「窗口聚合」vs「实时 tail」。
- **[Trade-off] 丢弃事件 vs 阻塞** → 网络流选丢弃+计数，保证 Core 存活优先。

## Migration Plan

- 新端点 additive；旧客户端仅使用 POST action **不受影响**。
- 回滚：移除路由与 CDP 订阅模块；无数据迁移。

## Open Questions

- `GET /v1/version` 字段名与枚举值是否与 OpenCLI/README 同步更新（建议在 tasks 中列「文档」一项）。
- 网络流默认是否 **stripQuery**（建议默认 `true`，与 action 默认一致，query 可覆盖）。

## 附录：最终实现路径与鉴权（与代码一致）

| 端点 | Query | 鉴权 |
|------|--------|------|
| `GET /v1/sessions/:sessionId/network/stream` | 必填 `targetId`；可选 `stripQuery`（`false`/`0` 关闭）、`maxEventsPerSecond`（1～200） | Bearer（与 `console/stream` 相同） |
| `GET /v1/sessions/:sessionId/runtime-exception/stream` | 必填 `targetId` | Bearer；且会话 **`allowScriptExecution`** 为 true，否则 **403** |

`GET /v1/version` 增加：`sseObservabilityStreams: ["network","runtime-exception"]`，`sseObservabilityStreamPaths` 含上述 path 模板。

### App-first CLI（`yarn oc <appId> <子命令>`）

与 **network / console / stack** 观测相关的子命令在 **`packages/core` CLI**（`od` / `yarn oc`）中提供，**不写 sessionId**：按 `appId` 解析活跃会话，未传 `--target` 时用 `list-window` 拓扑第一个 target。

| App-first 子命令 | 类型 | 对应 Core API |
|------------------|------|----------------|
| `network-observe` | 短时 JSON | `POST /v1/agent/sessions/:id/actions`，`action: network-observe` |
| `network-stream` | SSE 长流 | `GET /v1/sessions/:sessionId/network/stream?targetId=...`（可选 `stripQuery`、`maxEventsPerSecond`） |
| `console-observe` | 短时 JSON | `POST .../actions`，`action: console-messages`（可选 `--wait-ms` 100～30000） |
| `console-stream` | SSE 长流 | `GET /v1/sessions/:sessionId/console/stream?targetId=...` |
| `stack-observe` | 短时 JSON | `POST .../actions`，`action: runtime-exception`（可选 `--wait-ms`；需 `allowScriptExecution`） |
| `stack-stream` | SSE 长流 | `GET /v1/sessions/:sessionId/runtime-exception/stream?targetId=...`（需 `allowScriptExecution`） |

长流子命令将响应 **原样写入 stdout**（SSE 帧）；**Ctrl+C / SIGTERM** 中断连接并释放服务端并发名额（与 `curl -N` 一致）。`--format table|json` 仅对 **JSON 短时**子命令有意义；**SSE 长流不适用 `--format`**。

解析与路由实现见：`packages/core/src/cli/parseAppFirstArgv.ts`、`packages/core/src/cli/appFirstRun.ts`；`od --help` 的 App-first 段落列出上述子命令与主要 flags。
