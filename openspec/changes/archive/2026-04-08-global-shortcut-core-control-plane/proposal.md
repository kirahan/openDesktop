## Why

当前全局快捷键的业务（矢量录制启停、打点等）经 **preload → Web 渲染进程** 执行，导致强依赖 React 挂载、IPC 订阅与 token 状态，易出现「主进程已收到按键、业务未执行」的脆弱链路；且第三方客户端无法复用同一套快捷键语义。

将 **闭集动作 → Core HTTP 控制面** 后，**Electron 主进程仅负责按键与 HTTP 调用**，核心逻辑集中在 Core，任意能通过 Bearer 访问 Core 的客户端（含未来第三方壳、CLI、自动化）均可一致处理。

## What Changes

- Core 提供 **新的控制面 HTTP API**（或文档化扩展现有路由）：接收 **闭集动作 ID**（及会话 / target 作用域参数），在进程内调用既有 `startPageRecording`、`stopPageRecording`、`ui-marker` 等逻辑，**不依赖 Web**。
- **Electron 主进程**在 `globalShortcut` 回调中：读取 Bearer（与现有主进程读 token 能力对齐）、调用 Core 控制面；可选保留向 Studio 渲染进程的 **轻量 IPC**（仅用于 UI 同步，非业务唯一路径）。
- **Studio Web**：快捷键配置 UI 仍可写 `localStorage` 并同步主进程绑定；**业务执行**从「渲染进程 handler」迁移为「主进程 → Core」；Web 侧可删除或降级为仅展示的快捷键业务代码（实现阶段在 tasks 中明确）。
- **BREAKING（行为语义）**：规范上 **不再要求**「业务仅在渲染进程内执行」；验收以 Core 与主进程为准。外置浏览器无全局键的行为不变。

## Capabilities

### New Capabilities

- `core-control-plane-shortcuts`：Core 对「闭集全局快捷键动作」的 HTTP 控制面（鉴权、路由、载荷、错误码、与既有录制/打点服务编排）。

### Modified Capabilities

- `studio-global-shortcuts`：将「按下快捷键后的业务执行」从「必须经渲染进程」调整为「主进程调用 Core 控制面为规范路径」；保留 Electron 注册闭集动作、Web 配置绑定等既有要求，并增补与 Core 对齐的验收场景。

## Impact

- **packages/core**：`createApp`（或等价 HTTP 层）新增/扩展路由；可能新增小模块编排 `recordingService` / markers。
- **packages/studio-electron-shell**：`main.js` 中快捷键回调改为 HTTP 调 Core；需稳定获取 `apiRoot`（或固定 `127.0.0.1:端口`）与 Bearer。
- **packages/web**：`App.tsx` 等与全局快捷键业务相关的 handler 可删除或改为仅订阅 Core/状态同步（按 tasks）。
- **第三方 / 测试**：可对 Core 新 API 做集成测试，无需启动 Web。