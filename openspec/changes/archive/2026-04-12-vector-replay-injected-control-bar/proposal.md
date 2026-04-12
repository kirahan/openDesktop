## Why

矢量录制与观测流已在 Core 与 Web 侧打通，但 **开始、停止、以及为某步标记「预期断言点」** 仍主要依赖用户在 OpenDesktop Web 中操作，与正在调试的 Electron 页面之间 **频繁切换窗口**，打断心流。在 **被调试页面内** 提供贴边的轻量控制条，可显著减少回到 Web 的次数，并与既有「页面注入脚本 + CDP」架构一致。

## What Changes

- 在矢量录制注入脚本所在页面中，增加 **边缘悬浮控制条**（开始录制、停止录制、以及「断言检查点」类操作入口；具体按钮集合以实现为准）。
- 录制管线 **MUST** 忽略所有落在控制条 DOM 子树内的指针与点击事件，使其 **不出现在** 矢量 JSON 流中（与现有检视 overlay 的「不污染录制」原则一致）。
- 提供 **从页面回到 Core 控制面** 的安全通路（例如新增 CDP `Runtime.addBinding` 专用于 UI 命令，由 Core 将 `stop` / `start` / `checkpoint` 等映射到既有 `startPageRecording` / `stopPageRecording` 与后续断言管线），**避免**在不可信页面中注入长期 Bearer token 或随意 `fetch` 跨域。
- OpenDesktop Web 侧可增加 **可选入口**（例如「在目标页显示控制条」或与录制联动自动注入），**非**唯一操作路径。
- **非目标（首版可不实现）**：全局 OS 级快捷键；复杂截图 diff 引擎；断言自动比对执行器。

## Capabilities

### New Capabilities

- `vector-replay-page-controls`：页面内矢量录制悬浮控制条、事件过滤规则、与 Core 的指令桥接及（可选）检查点事件语义。

### Modified Capabilities

- 无（现有 `page-replay` / SSE 行为以保持兼容为主；若新增 `checkpoint` 类事件行，在 `vector-replay-page-controls` spec 中定义并由 archive 合入主规格时再处理跨 spec 引用）。

## Impact

- **Core**：`session-replay/recordingService.ts`（注入脚本体积与生命周期）、CDP `Runtime.addBinding` 与 `bindingCalled` 处理；可能涉及 `createApp` 中与会话相关的路由（若需显式 API 启用控制条）。
- **Schema**：若引入新的 replay 信封类型（如 `checkpoint`），需 `session-replay/schema.ts` 与文档同步。
- **Web**：可选 UI 开关；主流程可不依赖。
- **安全**：本地信任模型不变；控制指令仅限已 attach 的调试会话上下文。
