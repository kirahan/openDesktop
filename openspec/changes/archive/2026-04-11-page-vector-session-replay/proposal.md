## Why

调试 Electron 网页时，团队需要把「用户在当前 page 上的操作」录成**可机器消费的事件序列**，用于后续生成测试用例或半自动回放；全量 DOM 与全屏视频成本高、带宽大。业界（如 Sentry Session Replay）已验证 **矢量回放**（结构快照 + 指针与交互事件）在单页场景可行。OpenDesktop 已具备 CDP 附着、会话、Web 控制台与 SSE 等基础，适合在**明确缩小范围**（仅当前附着 page、可注入、主框架）下引入**页面矢量会话录制与回放**能力。

## What Changes

- 新增「页面会话录制」能力：在**用户显式开启录制**且会话满足条件时，向当前 **CDP page target** 注入录制逻辑，采集 **指针类事件（经降采样）与点击**，并周期性或在关键节点采集 **无障碍/骨架级结构快照**（第一期不处理 iframe、canvas）。
- 新增从 Core 到 Studio/Web 的**实时事件与快照推送通道**（协议在 design 中定稿，形态可为 SSE 或 WebSocket），用于**类 Sentry 的矢量预览**（指针 overlay + 结构），**不要求**逐帧全图视频流。
- 可选：低频关键帧截图作为辅助（非默认主路径）。
- **非目标（第一期）**：跨 iframe、Canvas 内容录制、操作系统级全局鼠标、无注入权限下的录制。

## Capabilities

### New Capabilities

- `page-session-replay`：定义单 page 矢量会话录制的范围、事件与快照 schema、鉴权与实时推送、以及 Web 侧回放视图的最低行为。

### Modified Capabilities

- （无）本变更不修改现有已归档 spec 的既有要求；与 `studio-live-console` 相邻但独立，避免在未实现前强行修改「实时控制台」语义。

## Impact

- **packages/core**：新路由或扩展现有 observability；可能与 CDP 注入、会话生命周期、限流与并发上限策略交互。
- **packages/web**：新面板或扩展现有「实时观测」区域，用于订阅录制流并做 overlay 回放预览。
- **依赖**：无强制新增重型依赖的先决条件；具体运行时依赖在 design 中评估。
- **安全**：录制数据可能含页面文本与交互路径，需在 design 中约定默认本地、鉴权与数据保留策略。
