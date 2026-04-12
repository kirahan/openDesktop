## Context

OpenDesktop 已通过 CDP 附着 Electron 子进程、提供 Agent 动作、控制台与网络等 SSE 流，以及 Web 右侧「实时观测」抽屉。用户希望在**单 page、可注入**前提下，录制指针与点击并推送**结构骨架快照**，在 Web 端做类 Sentry 的**矢量回放**（非全屏视频）。第一期明确排除 iframe、canvas 与 OS 级输入捕获。

## Goals / Non-Goals

**Goals:**

- 定义并实现**录制开关**下的**事件 + 结构快照**最小闭环（Core 采集 → 鉴权推送 → Web 展示 + overlay）。
- 指针移动**限流**，点击**高保真**记录。
- 与现有 Bearer、会话状态、CDP target 模型一致。

**Non-Goals（第一期）：**

- iframe / 跨域子文档 / Canvas 内容录制与回放。
- 全帧屏幕录像或 WebRTC 级实时镜像。
- 自动生成稳定 E2E 脚本并一键运行（仅可为后续能力预留 schema）。

## Decisions

1. **注入方式**  
   - **决策**：在 `allowScriptExecution: true` 时通过 **CDP Page.addScriptToEvaluateOnNewDocument** 或等价 **Runtime.evaluate** 注入 recorder；若策略要求与现有 Agent 注入路径统一，优先复用会话侧已有「可执行脚本」通道。  
   - **备选**：独立 CDP 命令直注；若与权限模型冲突，在实现阶段以 spec 为准修订。

2. **传输协议**  
   - **决策**：优先 **SSE**（与现有 `console/stream` 一致），事件负载为 **NDJSON 或 `data:` 内 JSON**；若双向控制（暂停/恢复）必需，再评估 **WebSocket**。  
   - **备选**：纯轮询 `GET` — 实时性差，不作为主方案。

3. **结构快照格式**  
   - **决策**：优先 **无障碍树摘要** 或 **与 Playwright `ariaSnapshot` 同类的 YAML 文本片段**（体积可控）；频率为**定时 + 点击前后可选触发**。  
   - **备选**：浅层 `outerHTML` 截断 — 仅作兜底 spike。

4. **坐标系**  
   - **决策**：统一使用 **CSS 像素 / client 坐标相对视口**，与 **viewport 宽高**一并上报，便于 Web 端缩放 overlay。

5. **并发与限流**  
   - **决策**：与现有 `consoleStreamLimiter` 模式对齐，为**录制流**增加独立计数器与上限；拒绝时返回 **429** 或可机读错误。

## Risks / Trade-offs

- **[Risk] 动态 class 导致回放无法复用同一 selector** → Mitigation：第一期以坐标 + 时间为主，结构快照用于人工阅读；后续再引入稳定 role/name 路径。  
- **[Risk] 注入脚本与业务脚本冲突** → Mitigation：命名空间隔离、仅录制模式开启时注入。  
- **[Risk] 性能：高频 pointer** → Mitigation：强制降采样与批量上报。  
- **[Risk] 隐私：页面文本进入快照** → Mitigation：文档注明默认本地、不落第三方；可选脱敏留待后续。

## Migration Plan

- 新能力默认**关闭**或需显式开启，不影响现有会话。  
- 回滚：移除路由与注入开关，保留 Core 兼容。

## Open Questions

- 录制文件是否持久化到 `dataDir`（JSONL）还是仅内存流？建议 spike 后再定。  
- 是否与 `studio-live-console` 共用 UI 抽屉或独立「录制」页签？

## Testing Strategy

- **单元测试**：事件限流函数、录制 payload 序列化、SSE 帧格式（`packages/core` 侧新模块，与现有 HTTP 测试风格一致）。  
- **集成测试**：Mock CDP 或现有 mock 子进程，验证「开启录制 → 注入 → 至少一条事件到达 HTTP 客户端」；鉴权失败与 429 路径。  
- **Web**：Vitest/React Testing Library 对「订阅 mock 流 → 列表追加 → overlay 坐标」做组件级测试（mock `fetch` + ReadableStream）。  
- **测试文件位置**：Core 与现有 `*.http.test.ts` / `createApp.test.ts` 并列；Web 与 `packages/web` 内现有测试布局一致。
