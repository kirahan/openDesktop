## Why

Studio 在 Windows 上无法使用「原生无障碍树 / 鼠标周围按点」观测 Qt 等无 CDP 应用：Core 仅在 darwin 声明并实现相关 HTTP 能力与 `capabilities`，与产品「跨平台观测」目标不一致。需要在 Windows 上提供与现有路由对齐的无障碍采集能力，并在版本探测中如实声明。

## What Changes

- 在 **Core（`packages/core`）** 为 **win32** 增加 **按点** 与（建议同里程碑或后续）**整树** 的无障碍实现，技术路径以 **UI Automation（首选）或 MSAA（OLEACC）** 为主，并对会话 **`pid`** 做 **命中校验**（按点结果须可归因到目标进程，否则返回可机读错误）。
- 扩展 **`GET /v1/version` → `capabilities`**：在实现就绪且运行时平台为 Windows 时声明 **`native_accessibility_at_point`**，并在整树实现就绪时声明 **`native_accessibility_tree`**（与 mac 行为一致：声明与真实可用性一致）。
- **可选**：扩展 **`getGlobalMousePosition`**（或等价模块），在 Windows 上支持省略 `x`/`y` 时使用 **当前全局指针坐标**（需注意 DPI / 多显示器与现有查询参数语义一致）。
- **不**改变现有 Bearer、路径、查询参数名称的对外契约；错误码与 mac 侧对齐（如 **`PLATFORM_UNSUPPORTED`**、**`SESSION_NOT_READY`**、**`PID_UNAVAILABLE`**、**`ACCESSIBILITY_DISABLED`**、**`MOUSE_POSITION_UNAVAILABLE`** 等）。

## Capabilities

### New Capabilities

- （无独立新 capability 目录；行为扩展归入下方「修改」的规格。）

### Modified Capabilities

- **`native-accessibility-at-point`**：将「仅 macOS」扩展为「macOS 与 Windows（实现就绪时）」；补充 **PID 校验**、**Win 实现** 与 **能力声明** 相关需求；调整「非支持平台」表述为按实现矩阵判定。
- **`native-accessibility-tree`**：同上，用于整树接口在 Windows 上的可用范围与能力声明（若本变更分期交付，规格中允许「仅先 at-point」的阶段性表述）。
- （可选）**`project-documentation`** 或 **`studio-shell-host`**：若需文档化 Windows 权限或坐标约定，以小增量修改（若仓库规范要求）。

## Impact

- **代码**：`createApp.ts`（`/version`、`/native-accessibility-*` 路由分支）、新建 `nativeAccessibility` 下 Win 实现模块（或 `ffi` / 子进程辅助）、`getGlobalMousePosition.ts`。
- **依赖**：可能新增 **原生绑定**（如 `koffi` / `ffi-napi`）或 **仓库内 C++/Rust 小工具**（需 Windows 构建与 CI 策略）。
- **测试**：HTTP 层集成测试（mock 或 fixture）、纯函数单元测试（解析与 PID 校验）；Win 特定行为在 CI 可用 **条件跳过** 或 **桩**。
- **Studio Web**：`capabilities` 更新后现有探测逻辑应自动启用控件；一般无需改 UI，除非错误文案需区分平台。
