## Why

Agent 在自动化与排障时需要理解「页面在一段时间内向业务后端发了多少 HTTPS/HTTP 请求、哪些慢、并发是否过高」。当前 Core 的 `network` 动作仅暴露 Cookie，无法统计请求量与耗时。通过 CDP `Network` 域采集并聚合，可在不引入系统级抓包的前提下，为 Agent 提供可机读的观测结果。

## What Changes

- 新增 **按 CDP target 的网络观测能力**：在可配置的短时间窗口内采集该 target 内发起的 HTTP(S) 请求元数据（URL、方法、状态、耗时等），并支持聚合统计（请求数、慢请求列表、并发峰值等）。
- 新增 **Agent HTTP 动词**（canonical 名在实现时与 `GET /v1/version` 的 `agentActions` 对齐），用于触发一次性窗口观测或返回结构化 JSON；**不**改变现有 `network`（Cookie 只读）的语义，避免 **BREAKING**。
- 文档：README / Core 包内短文说明与 `targetId`、会话、`allowScriptExecution`（若实现选择对齐）的关系。

## Capabilities

### New Capabilities

- `cdp-network-observability`：基于 CDP Network 域的 HTTPS/HTTP 请求采集、聚合与对 Agent 的 JSON 呈现。

### Modified Capabilities

- （无）本变更不修改已有 spec 中的规范性条款；与 `studio-live-console` 等控制台能力正交。

## Impact

- **代码**：`packages/core/src/cdp/`（Network 订阅与聚合）、`packages/core/src/http/registerObservability.ts`（新动作路由）、`agentActionAliases.ts`、`README.md`。
- **依赖**：无新增重型依赖（沿用现有 CDP WebSocket 客户端模式）。
- **风险面**：观测数据可能含 URL/路径，需在设计与实现中约定脱敏与条数上限。
