# studio-electron-global-shortcuts

## 概述

**一句话**：在 **Electron 基座**下提供 **全局**快捷键（`globalShortcut`），将闭集动作（矢量录制切换、打入点、出点、检查点）投递到 Studio 渲染进程执行；**Node 基座 / 外置浏览器**不展示快捷键配置 UI。

**背景与动机**：矢量录制与打点常需在 **焦点不在 Studio** 时操作。浏览器无法提供可靠全局快捷键，属 **壳差异化能力**；需在主进程注册、Web 可配置，且避免任意代码执行。

**影响范围**：`packages/studio-electron-shell`（主进程 + preload）、`packages/web`（配置 UI + 动作处理 + 测试）、`docs/studio-shell.md`；Core 无强制变更。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件 |
|---|------|------|---------|
| 1 | 主进程 `globalShortcut` | 按动作 ID 注册/注销；退出 `unregisterAll` | `packages/studio-electron-shell/src/main.js`（或拆分模块） |
| 2 | IPC | `invoke` 同步绑定；`send` 投递动作 ID | 同上 + preload |
| 3 | Preload API | `contextBridge` 暴露绑定与订阅 | `packages/studio-electron-shell/src/preload.cjs` |
| 4 | Web 配置 UI | 仅 `kind === 'electron'` 渲染 | `packages/web/src/App.tsx` 或独立组件 |
| 5 | 动作处理 | 与现有按钮共用 handler | `packages/web/src/...`（与矢量录制入口对齐） |
| 6 | 持久化 | `localStorage` + 启动同步主进程（见 design） | Web + IPC |
| 7 | 文档 | 壳能力说明 | `docs/studio-shell.md` |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|-------------------|
| 全局 vs 应用内 | **全局**（用户已确认） | 仅应用内无法满足「失焦操作」 |
| 录制键位 | **单键 toggle** MVP | 减少键位；两键可后续加 |
| 持久化 | **localStorage + 启动同步** | 与 Web 配置习惯一致 |
| 安全模型 | **闭集动作 ID** | 禁止任意脚本 |

### 技术细节

- 主进程：`globalShortcut.register(accelerator, () => mainWindow.webContents.send('od-global-shortcut-action', { actionId }))`（通道名可最终实现时统一）。
- 渲染进程：`ipcRenderer.on` 在 preload 中转为 `onGlobalShortcutAction(cb)`。
- 配置变更：先 `unregisterAll`，再按新表注册；失败项返回错误供 UI 展示。
- 动作 ID：`vector-record-toggle`、`segment-start`、`segment-end`、`checkpoint`（与代码对齐时统一映射表）。

## 验收标准

> 测试与产品验收以本节为准（对应 spec 场景）。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 全局触发 | Electron 下按下已绑定且注册成功的快捷键 | 渲染进程收到对应动作 ID 并执行业务 |
| 2 | Node 基座 | 外置浏览器打开 Studio | 无全局快捷键注册；**不展示**配置区块 |
| 3 | 配置可见性 | Electron 内打开 Studio | **展示**快捷键配置能力 |
| 4 | 注册失败 | 配置已被占用或非法 accelerator | 该绑定不生效；用户可见错误/状态；不静默成功 |
| 5 | 退出 | 退出 Electron | 全局快捷键全部注销 |
| 6 | 行为一致 | 快捷键触发与点击对应按钮在同一状态下 | 效果一致（含无会话等边界） |
| 7 | 闭集安全 | 任意用户输入 | 仅允许文档化动作 ID，不执行任意脚本 |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | 主进程注册封装 | globalShortcut + 退出清理 | — |
| 2 | IPC + preload | invoke / send / 订阅 | 1 |
| 3 | Web 类型与 UI | 仅 Electron 可见配置 | 2 |
| 4 | 动作绑定业务 | 与按钮 handler 一致 | 3 |
| 5 | 持久化与启动同步 | localStorage ↔ 主进程 | 2、3 |
| 6 | 测试 + 文档 | 单测 + studio-shell.md | 1–5 |

## 测试要点

- Mock shell：**非 electron** 不渲染配置；**electron** 渲染。
- Mock IPC：动作 ID 到达后调用正确 handler。
- 回归：Node 基座现有流程不受影响；Electron 无快捷键时应用不崩溃。
