# Delta: native-accessibility-at-point

## RENAMED Requirements

- **FROM:** `### Requirement: 仅 macOS 且会话就绪时提供按点局部 AX 接口`
- **TO:** `### Requirement: 支持平台且会话就绪时提供按点局部无障碍接口`

- **FROM:** `### Requirement: 坐标来源与 nut-js 约定`
- **TO:** `### Requirement: 坐标来源与平台实现约定`

- **FROM:** `### Requirement: 权限与辅助功能失败语义`
- **TO:** `### Requirement: 权限与无障碍 API 失败语义`

## MODIFIED Requirements

### Requirement: 支持平台且会话就绪时提供按点局部无障碍接口

系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端在 **`process.platform === "darwin"` 或（实现就绪时的）`"win32"`**、会话 **`state === "running"`**、且存在 **非空 `pid`** 时，基于 **屏幕像素坐标** 获取 **无障碍局部子树** 快照（macOS 为 Accessibility；Windows 为 UI Automation，以实现为准）。在 **不支持** 该实现的平台上，该接口 SHALL 失败并返回可机读错误码（如 **`PLATFORM_UNSUPPORTED`**），且 SHALL NOT 声称成功正文。在 **Windows** 上，系统 SHALL 在校验流程中确保 **命中元素所属进程 ID** 与会话 **`pid`** 一致；不一致时 SHALL 返回可机读错误（如 **`HIT_OUTSIDE_SESSION`**），且 SHALL NOT 返回 200 声称成功局部树正文。

#### Scenario: 不支持的平台拒绝

- **WHEN** Core 运行在既非 darwin、也未启用 Windows 实现的平台上且客户端调用该接口
- **THEN** 响应 SHALL 为 **4xx** 且 SHALL NOT 返回声称成功的局部无障碍树正文

#### Scenario: 会话未运行或无 pid 时拒绝

- **WHEN** 会话未处于 `running` 或缺少 `pid`
- **THEN** 请求 SHALL 失败并返回可机读错误码（如 **`SESSION_NOT_READY`** / **`PID_UNAVAILABLE`**）

#### Scenario: Windows 命中不在会话进程内

- **WHEN** Core 运行在 `win32` 且命中元素的 **`ProcessId`** 与会话 **`pid`** 不一致
- **THEN** 响应 SHALL 失败并返回可机读错误码（如 **`HIT_OUTSIDE_SESSION`**），且 SHALL NOT 将此次命中当作成功局部树返回

### Requirement: 坐标来源与平台实现约定

当请求 **未** 提供显式坐标参数 **`x`/`y`** 时：在 **`darwin`** 上 Core SHALL 使用 **`@nut-tree/nut-js`** 的 **`mouse.getPosition()`**（或文档化等价 API）读取 **当前全局指针位置**；在 **`win32`** 上 Core SHALL 使用 **Win32 GetCursorPos** 语义（经 PowerShell 或项目文档化的等价实现）读取 **屏幕像素坐标**。当 **显式** 提供合法坐标时，Core SHALL **优先**使用显式坐标（用于测试与调试）。

#### Scenario: 显式坐标优先于隐式鼠标

- **WHEN** 请求同时包含合法显式 `x`/`y` 与可用的隐式鼠标读取路径
- **THEN** 命中计算 SHALL 使用显式坐标

#### Scenario: win32 隐式坐标失败

- **WHEN** 请求未带显式坐标且 Win32 鼠标读取失败
- **THEN** 响应 SHALL 返回可机读错误码（如 **`MOUSE_POSITION_UNAVAILABLE`**），且 SHALL NOT 返回 200 局部树

### Requirement: 权限与无障碍 API 失败语义

当因 **辅助功能未授权**（macOS）或 **UI Automation 程序集加载失败 / 运行时不可用**（Windows）等权限或环境原因导致无法采集时，响应 SHALL 为 **403**（或项目约定权限类 4xx），且 SHALL 包含可机读错误码（如 **`ACCESSIBILITY_DISABLED`**）。当 **隐式鼠标位置** 不可用（darwin 上 nut-js 失败或 **win32** 上 GetCursorPos 失败）且 **未** 提供显式坐标时，响应 SHALL 返回可机读错误码（如 **`MOUSE_POSITION_UNAVAILABLE`**），且 SHALL NOT 假装成功。

#### Scenario: 隐式鼠标失败且无显式坐标

- **WHEN** 请求未带显式坐标且当前平台的隐式鼠标读取失败
- **THEN** 响应 SHALL 失败并 SHALL NOT 返回 200 局部树

#### Scenario: macOS 未授权与 Windows UIA 不可用可区分

- **WHEN** 底层返回权限或 UIA 环境类错误
- **THEN** 响应 SHALL 为非成功 HTTP 语义，且正文 SHALL 含 **`ACCESSIBILITY_DISABLED`** 或文档化等价码

### Requirement: 能力探测

`GET /v1/version` 的 **`capabilities`** 数组 SHALL 能表明是否支持 **`native_accessibility_at_point`**：**darwin** 在功能可用时列出；**win32** 仅在 Windows 实现已就绪并可用时列出；其它未实现平台 SHALL NOT 列出或等价为不可用。

#### Scenario: 能力与实现一致

- **WHEN** Core 运行在 darwin 或已启用实现的 `win32` 上且功能可用
- **THEN** `capabilities` 声明 SHALL 与接口实际可用性一致

### Requirement: Studio Qt 会话提供鼠标周围拉取

当会话 **`uiRuntime` 为 `qt`**、能力可用且会话满足前置条件时，Studio SHALL 提供 **「捕获无障碍树（鼠标周围）」** 控件，触发上述 HTTP 请求，并以 **与整树一致或更易读** 的树状/折叠视图展示结果；失败时 SHALL 展示 Core 错误信息（含 **鼠标位置不可用**、**命中不在会话内** 与 **403** 类错误；平台文案以实现为准）。

#### Scenario: Qt 可触发鼠标周围拉取

- **WHEN** `uiRuntime` 为 `qt` 且能力与会话状态满足
- **THEN** 用户 SHALL 能点击「鼠标周围」并成功看到结果或错误说明
