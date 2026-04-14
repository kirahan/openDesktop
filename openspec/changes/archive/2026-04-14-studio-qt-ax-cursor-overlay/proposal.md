## Why

Qt 类应用无 CDP/DOM，观测依赖 macOS **Accessibility** 与 **`native-accessibility-at-point`**。已有「按点拉局部树」能力，但缺少**与指针位置对齐的视觉锚点**，用户难以建立「树节点 ↔ 屏幕」的直觉。Electron 基座普及后，可用**透明覆盖层**在屏幕上绘制**十字线或点标记**，与同一套屏幕坐标下的 AX 树联动，接近 Electron/CDP 场景「指哪看哪」的体验。本变更将 MVP 明确为 **树 + 光标指示**，**不**引入控件矩形几何（不依赖 `kAXFrame` 等扩展）。

## What Changes

- 在 **Electron 壳**（`packages/studio-electron-shell`）增加可选 **透明 BrowserWindow**（或等价全屏透明层），用于在「Qt AX 捕获模式」下显示 **十字线或点标记**，坐标与 **`GET .../native-accessibility-at-point`** 使用的**屏幕像素坐标系**一致。
- 在 **Studio Web**（`packages/web`）为 **`uiRuntime === 'qt'`** 且能力与会话就绪时，提供进入/退出该模式的控件；在模式下以**节流**方式用显式 **`x`/`y`** 请求 at-point，并展示树结果（复用/扩展现有树视图）。
- **不**修改 Core AX Swift 协议以返回控件 **frame**（矩形高亮列为后续变更）；**不**要求 Node 基座 + 外置浏览器实现全屏覆盖（可文档化降级：仅按钮拉树 + 可选读数）。

## Capabilities

### New Capabilities

- `studio-qt-ax-cursor-overlay`：约定 Studio 在 Electron 基座下为 Qt 会话提供的 **AX 光标捕获模式**（透明层 + 十字线/点 + 与 `native-accessibility-at-point` 联动、节流与显式坐标）；明确 **非目标**（无矩形描边、无 Windows UIA 等价覆盖）。

### Modified Capabilities

- `studio-shell-host`：增加 **ADDED** 要求——Electron 壳 **MAY** 提供透明覆盖窗口及 **preload/IPC** 契约，供 Web 启停捕获模式并同步指针坐标（实现细节见 design）。

## Impact

- **packages/studio-electron-shell**：主进程窗口生命周期、透明与点击策略、与渲染进程消息通道。
- **packages/web**：Qt 会话观测区 UI、调用 at-point 的频率控制、与 shell API 的集成及无壳降级。
- **packages/core**：**无** HTTP 行为变更（复用现有 at-point）；可选文档补充。
- **风险**：多显示器 / Retina 坐标一致性、透明层与「穿透点击」交互需在实现阶段验证。
