## 1. Spike 与壳侧骨架

- [x] 1.1 在 `packages/studio-electron-shell` 验证透明全屏 `BrowserWindow` + 十字线/点绘制（canvas 或 CSS），并记录 **macOS** 下 `setIgnoreMouseEvents`（或等价）与全局指针坐标获取的可行组合
- [x] 1.2 设计并实现 **preload** 暴露的 API 形状（`startQtAxOverlay` / `stop` / 坐标事件或轮询），写入 `docs/studio-shell.md` 或壳 README 片段

## 2. Electron 主进程与覆盖窗口

- [x] 2.1 主进程实现覆盖窗口的创建、显示、隐藏、销毁；退出 Electron 时确保释放
- [x] 2.2 将 **屏幕像素坐标** 以稳定契约送达渲染进程（与 `design.md` 决策一致）

## 3. Web（Studio）集成

- [x] 3.1 在会话观测区为 **`uiRuntime === 'qt'`** 且能力/会话就绪时增加「AX 捕获模式」入口；无 Electron 壳时降级为既有 at-point 按钮路径且不抛错
- [x] 3.2 捕获模式内：节流调用 **`GET .../native-accessibility-at-point`**（显式 `x`,`y`），展示树/错误；模式退出时停止请求与 overlay
- [x] 3.3 将 `nativeAccessibilityAtPointDisabledReason` 等与 UI 禁用条件对齐

## 4. 测试与文档

- [x] 4.1 为 Web 侧节流与「无 shell 降级」补充单元测试（mock shell）
- [x] 4.2 更新 `docs/API.md` 或 Studio 用户向说明：本 MVP **不含**控件矩形；坐标与 at-point 一致
