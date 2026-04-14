## Why

在 **Electron 基座**下，用户经常需要在 **焦点不在 Studio 窗口** 时仍能快速操作矢量录制与打点（打入点、出点、检查点）。浏览器 / **Node 基座**无法提供可靠的全局快捷键，只能通过页面内交互。为对齐「壳差异化能力」策略，应在 Electron 主进程注册 **全局快捷键**，将按键映射为 **闭集业务动作**，并与现有 Web 业务路径一致。

## What Changes

- **Electron 壳（主进程）**：使用 `globalShortcut`（或等价）注册/注销 **全局**快捷键；应用退出时卸载全部注册；向渲染进程通过 IPC 投递 **动作 ID**（非任意脚本）。
- **Preload**：暴露 **Promise 式** API：查询/更新绑定、订阅快捷键触发、读取注册失败原因（按动作或汇总）。
- **Web（Studio）**：新增 **快捷键配置 UI**（展示动作说明、快捷键输入、恢复默认、错误提示）；**仅当** `window.__OD_SHELL__?.kind === 'electron'` 时展示；Node 基座 + 外置浏览器下 **不显示** 该配置区块。
- **动作范围（MVP）**：闭集枚举，至少覆盖——**矢量录制开关（或开始/停止，见 design）**、**打入点（segment in）**、**出点（segment out）**、**检查点（checkpoint）**；具体与现有 replay / segment / checkpoint 实现对接。

## Capabilities

### New Capabilities

- `studio-global-shortcuts`：约定 Electron 全局快捷键的注册语义、与 Web 的配置同步、失败与冲突行为、以及 Node 基座下 **不得** 暴露配置 UI 的要求。

### Modified Capabilities

- `studio-shell-host`：在既有「Electron 差异化能力」之上，增加 **全局快捷键** 作为可选壳能力（主进程 + preload 契约）。

## Impact

- **packages/studio-electron-shell**：主进程 `globalShortcut`、IPC、preload 扩展。
- **packages/web**：设置或观测区附近新增配置块；`studioShell.ts` 类型扩展；动作处理复用或调用既有矢量录制 / 打点 API。
- **packages/core**：无强制 HTTP 变更；若打点通过既有会话 API，仅 Web 侧组合调用。
- **安全**：仅允许闭集动作 ID，禁止任意代码执行。
