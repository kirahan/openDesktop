## Why

OpenDesktop 已通过 CDP 观测 **Chromium/Electron 渲染层**，但用户已能注册并启动 **Qt 等原生应用**（例如 OBS）：这类进程没有可用的 `page` target，**无法**用 DOM/CDP 获取窗口与控件结构。要在 Studio 或 Agent 侧做「看见界面结构、再编排动作」，需要接入 **操作系统级无障碍（Accessibility）** 暴露的 UI 树。先做 **macOS**（AX API），与当前主力开发环境一致。

## What Changes

- 新增 **macOS 原生无障碍树采集**能力：在会话子进程（已知 PID）维度，调用系统 API 枚举 **AXUIElement** 子树，序列化为 **JSON** 供 Core 返回。
- 新增 **HTTP API**（Bearer 鉴权、与会话绑定）：仅当 `process.platform === "darwin"` 且会话 `**running`** 且具备合法 `**pid`** 时可用；其他平台返回可机读 **不支持** 或 **前置条件不满足**。
- **Studio（Web）必做**：在会话观测区提供 **「一键拉取原生无障碍树」**（面向 Qt/OBS 等无 CDP 页面之会话），将 HTTP 返回结果以 **树状或可折叠 JSON** 等形式展示；非 macOS 或 Core 未声明能力时按钮禁用并提示原因。

## Capabilities

### New Capabilities

- `native-accessibility-tree`：定义「按会话 PID 在 macOS 上采集无障碍 UI 树并对外返回」的契约（错误码、深度/节点上限、权限失败语义）。

### Modified Capabilities

- （无）本阶段不修改既有 CDP / Agent 规格；与 `agent-dom-explore` 等并存，由路由与能力探测区分。

## Impact

- **packages/core**：新增 macOS 实现模块、HTTP 路由、`/v1/version` 能力探测字段（若项目惯例包含 capabilities）。
- **packages/web（Studio）**：会话列表/观测区增加拉取与展示原生无障碍树的 UI，与 `capabilities` 联动。
- **权限**：用户可能需在「系统设置 → 隐私与安全性 → 辅助功能」中授权 **运行 Core 的终端/二进制**（详见 design）。
- **无**新增第三方网络依赖；可能增加 **极小本地原生辅助进程** 或 **Swift/ObjC 桥**（由 design 定稿）。