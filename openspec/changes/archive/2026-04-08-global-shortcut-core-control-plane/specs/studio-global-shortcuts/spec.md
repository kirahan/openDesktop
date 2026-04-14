# studio-global-shortcuts — Delta（本变更）

## ADDED Requirements

### Requirement: Electron 主进程为全局快捷键业务的主路径

当 **`window.__OD_SHELL__?.kind === 'electron'`** 且用户按下已注册的闭集快捷键时，系统 SHALL 由 **Electron 主进程** 完成向 **Core HTTP 控制面** 的调用以执行业务；**SHALL NOT** 将「Studio Web 渲染进程已挂载并已订阅 IPC」作为完成该业务的必要条件。

Studio Web MAY 接收 **仅用于 UI 同步** 的 IPC 或状态更新，SHALL NOT 作为唯一执行业务的路径。

#### Scenario: Web 未打开时快捷键仍可执行业务

- **WHEN** Electron 应用已启动、主进程已成功注册全局快捷键且 Bearer 可用，但用户未打开或未加载 Studio Web
- **THEN** 用户按下快捷键时 Core 控制面 SHALL 仍能被主进程调用并成功执行业务（在会话与 target 前提满足时）

## MODIFIED Requirements

### Requirement: Electron 全局快捷键仅映射闭集动作

当 **`window.__OD_SHELL__?.kind === 'electron'`** 且壳已实现本能力时，系统 SHALL 通过 **Electron 主进程** **`globalShortcut`**（或文档化等价）注册 **全局**快捷键。每个已注册快捷键 SHALL 仅映射到 **闭集动作 ID** 之一（至少包含：**矢量录制切换**、**打入点**、**出点**、**检查点**）；系统 SHALL NOT 将快捷键映射为任意脚本执行或任意 URL 打开。

主进程 SHALL 在 **应用退出**或 **显式停止快捷键服务**时 **注销**全部已注册全局快捷键。

#### Scenario: 按下已绑定全局键时主进程调用 Core 控制面

- **WHEN** 用户按下与某动作 ID 成功绑定的 accelerator，且应用未退出
- **THEN** Electron 主进程 SHALL 使用该闭集 **动作 ID**，通过 **Bearer 鉴权** 调用 Core **文档化控制面 API** 以触发等价业务效果；业务逻辑 SHALL 在 **Core** 内执行

#### Scenario: Node 基座不注册全局快捷键

- **WHEN** 用户仅使用 Node 基座 + 外置浏览器（无 Electron shell）
- **THEN** 系统 SHALL NOT 注册全局快捷键；SHALL NOT 要求浏览器实现 `globalShortcut`

### Requirement: 与矢量录制及打点业务一致

当用户通过 **全局快捷键** 触发闭集动作时，系统 SHALL 产生与 **既有 Studio UI 控件** 在 **相同会话与 target 上下文** 下等价的业务效果（矢量录制切换、打入点、出点、检查点）。规范路径为 **Electron 主进程 → Core 控制面**；若实现保留向渲染进程的兼容通知，SHALL NOT 导致与按钮路径 **重复** 的业务副作用（例如同一次按键两次 `start`）。

#### Scenario: 动作与按钮行为对齐

- **WHEN** 用户通过全局快捷键触发某动作，且应用状态与在 Studio 内点击对应该动作的控件时等价
- **THEN** 系统行为 SHALL 与点击控件的结果一致（含无操作、错误或可机读失败）
