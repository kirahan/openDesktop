## Context

- 现有实现：`collectConsoleMessagesForTarget`（`packages/core/src/cdp/browserClient.ts`）对单 target **短时** attach、`Runtime.enable`、监听 `Runtime.consoleAPICalled`，等待 `waitMs` 后断开并返回数组；Agent `console-messages` 暴露给 Studio。
- 局限：无法形成「持续追加」的 DevTools 式体验；CDP 本身**不提供历史控制台**（仅能收连接后的新事件）。
- 约束：Core 默认本机 Bearer；Studio 与 API 同源；需控制长连接数量与内存。

## Goals / Non-Goals

**Goals:**

- 对**单个** `(sessionId, targetId)` 提供**实时**控制台事件流，供 Studio 在固定区域（如右侧）展示。
- 明确定义：开始订阅、停止订阅、切 target、会话结束时的行为。
- 可测试：Core 侧协议/事件转发与资源上限；Web 侧订阅与渲染边界。

**Non-Goals:**

- Network 面板、请求列表、HAR、`Network.*` 事件流（明确排除）。
- 与官方 DevTools 完全一致的 filter / preserve log / 多 context 等高级能力。
- 跨多个 target 合并为一条时间线（可作为后续增强；首版可只支持单 target 订阅）。

## Decisions

1. **传输层：SSE vs WebSocket**
   - **推荐 SSE（`text/event-stream`）**：单向 Server→Client、浏览器 `EventSource` 原生支持、同源 Cookie/Bearer 头需注意（`EventSource` 不支持自定义 Header 时，可用 query 短期 token 或沿用现有 session 模型下的子路径鉴权；若项目已统一 Bearer 头，可选用 **WebSocket** 单连接双向或 SSE + 单独握手）。  
   - **待定**：实现前在代码库中选定一种，并在 API 文档中写清鉴权方式（禁止无鉴权裸奔）。

2. **CDP 连接模型**
   - **选项 A**：每个活跃「控制台流」订阅对应一条 **持久** Browser CDP WebSocket + attach session，直到客户端断开或超时。  
   - **选项 B**：复用 Browser 级连接、多 session 多路（若现有 `BrowserCdp` 支持）。  
   - **倾向**：首版以实现简单、可证明正确为先（常为每流独立连接 + 明确上限 `N` 路）；在 `tasks` 中落地并压测。

3. **与 `allowScriptExecution`**
   - **倾向**：Console 监听为只读 CDP，**SHALL NOT** 要求 Profile `allowScriptExecution: true`（与 `console-messages` 对齐；若当前短采样也不要求，则流式也不要求）。在 spec 中写成可验收条款。

4. **与现有 `console-messages` 关系**
   - **并存**：短时采样保留（脚本/自动化兼容）；Studio 主路径引导至「实时流」；文档说明二者差异。

5. **背压与内存**
   - Core 侧对未消费事件或慢客户端：**丢弃最旧**或**断开**（二选一写进 spec）；单连接队列上限可配置默认值。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 长连接占用 CDP/文件描述符 | 每会话限制并发流数量；超时自动释放 |
| 日志洪泛撑爆内存 | 队列上限 + 丢弃策略；Studio 虚拟列表仅渲染可视区 |
| EventSource 无法带 Bearer | 改用带鉴权的 WS，或 `fetch`+流式 polyfill；实现前 spike |
| 切 target 时旧连接泄漏 | `tasks` 中强制 finally 关闭 CDP；集成测试覆盖 |

## Migration Plan

- 新端点/新 UI，**不破坏**现有 `POST .../actions` `console-messages`。
- 回滚：关闭新路由或 feature flag（若引入）；无数据迁移。

## Open Questions

- 单用户是否允许**同时**订阅多个 target（多 tab）？建议首版 **仅单流**，降低复杂度。
- 是否需要在事件中带 **targetId** 前缀（多窗口未来扩展）。

## Testing Strategy

- **Unit**：事件序列化、队列截断逻辑、CDP 回调到 SSE/WS 的映射（可用 mock CDP）。
- **Integration**：Core 启动后创建会话，连接流端点，页面 `console.log`，断言客户端收到事件顺序与字段；停止会话后流关闭。
- **Web**：组件测试或 E2E（若项目已有）：订阅开始后 mock 流，断言列表追加与清屏。
- **位置**：与现有 Core 测试一致（`packages/core` 旁 `*.spec.ts` / `*.test.ts`）；Web 与 `App` 或新组件同目录或 `__tests__/`。
