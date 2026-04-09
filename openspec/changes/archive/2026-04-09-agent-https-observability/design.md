## Context

Core 已通过 CDP 附加 `targetId`（`Page` / `WebView` 等），并实现 `Network.enable` + `Network.getCookies`。尚未订阅 `Network.requestWillBeSent`、`Network.loadingFinished` 等事件做请求级观测。Electron/Chromium 中，对**某一 target** 启用 Network 域可观察该渲染上下文中发起的 `fetch`/XHR 等请求（主进程直连流量不在此列）。

## Goals / Non-Goals

**Goals:**

- 在单次 Agent 请求可完成的 **短时间窗口** 内，采集该 target 的 HTTP(S) 请求元数据并 **聚合**（总数、耗时分布或慢请求列表、in-flight 并发峰值等可机读字段）。
- 响应体为 **稳定 JSON schema**（版本字段可选），便于 Agent 消费。
- 对 URL 长度、返回条数设 **硬上限**，避免 OOM。

**Non-Goals:**

- 不实现系统级 mitmproxy/抓包；不替代用户桌面网络代理。
- MVP **不强制** 存储或返回完整 request/response body（若后续要加，单独立项）。
- 不在本变更中解决「多 WebView 自动合并」——由调用方选择 `targetId`。

## Decisions

1. **新动词 vs 扩展 `network`**  
   - **决策**：新增独立 canonical 动词（例如 `network-observe` 或 `https-summary`，实现时二选一并写入版本列表），现有 `network` 仍只返回 Cookie。  
   - **理由**：避免破坏既有客户端对 `network` 响应形状的假设。

2. **触发模型**  
   - **决策**：**单次请求触发、固定窗口**（`windowMs` 有上下限），窗口内启用 Network 域并监听事件，窗口结束后聚合返回并释放监听。  
   - **备选**：长连接 + `stop`（复杂度高，非 MVP）。

3. **并发「高」的可操作定义**  
   - **决策**：在窗口内维护 `requestId` 集合，计算 **任意时刻未结束请求数的最大值** 作为 `maxConcurrent`（或等价命名）。  
   - **理由**：与 HTTP/2 多路复用解耦，贴近「业务未完成请求堆积」语义。

4. **慢请求**  
   - **决策**：返回耗时超过阈值（可配置，有默认）的前 N 条（N 有上限），字段含 `url`（可配置是否 strip query）、`durationMs`、`method`。

5. **权限**  
   - **决策**：要求与会话一致的有效 `targetId` 与 CDP；是否与 `allowScriptExecution` 强制绑定在实现中 **二选一**并在 spec 写死一种：倾向 **不依赖** Runtime 脚本（Network 域独立），但若产品要求与 `click` 同级 gate，则统一为需 `allowScriptExecution: true`。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 高频页面产生海量事件 | `maxEntries` 截断 + 仅保留聚合与 Top-N 慢请求 |
| URL 含敏感 query | 默认 strip query 或哈希，由 spec 约定 |
| 大页面 + 长窗口 CPU | 默认 `windowMs` 上限（如 30s） |

## Migration Plan

新增 API，无数据迁移。旧客户端忽略未知 `action` 即可。

## Open Questions

- 是否与 `allowScriptExecution` 绑定：待 apply 前对照 `registerObservability` 中其它只读动作的最终结论。

## Testing Strategy

- **单元测试**：纯函数级聚合逻辑（给定合成事件序列 → 期望 `count` / `maxConcurrent` / `slowRequests`）。
- **集成测试**：`supertest` + mock CDP（与 `agentActions.http.test.ts` 模式一致），覆盖成功、超时、会话缺失。
- **位置**：`packages/core/src/cdp/*.test.ts`（聚合模块）、`packages/core/src/http/*network*.http.test.ts`。
