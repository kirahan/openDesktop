# Delta: native-accessibility-at-point

## RENAMED Requirements

- **FROM:** `### Requirement: 仅 macOS 且会话就绪时提供按点局部 AX 接口`
- **TO:** `### Requirement: 支持平台且会话就绪时提供按点局部无障碍接口`

- **FROM:** `### Requirement: 坐标来源与 nut-js 约定`
- **TO:** `### Requirement: 坐标来源与指针读取约定`

## ADDED Requirements

### Requirement: Windows 上按点命中须可归因于会话子进程

当 **`process.platform === "win32"`** 且实现已启用时，系统在返回 **200** 与局部无障碍树正文前，SHALL 校验 **按点命中** 所对应 UI 元素（或其关联顶层窗口）所属 **进程 ID** 与会话 **`pid`** **一致**（或文档化且可测试的等价规则，例如同一进程组下的白名单）。若命中落在 **其它进程**（含其它桌面应用或系统 UI），响应 SHALL 为 **4xx**，且 SHALL 包含可机读错误码（如 **`HIT_OUTSIDE_SESSION`** 或项目约定的 **`VALIDATION_ERROR`**），且 SHALL NOT 返回声称成功的局部树正文。

#### Scenario: 命中非会话 pid 时拒绝

- **WHEN** 屏幕坐标下最前命中属于进程 A，而会话 `pid` 指向进程 B 且不满足等价规则
- **THEN** 响应 SHALL 失败（非 200），且 SHALL NOT 将进程 A 的树伪装为会话 B

#### Scenario: 命中会话 pid 时允许

- **WHEN** 命中可归因到会话 `pid`
- **THEN** 系统 MAY 返回 200 与局部树正文（仍受其它上限与权限约束）

### Requirement: Windows 上省略坐标时的指针来源

当 **`process.platform === "win32"`**、请求 **未** 提供显式 **`x`/`y`**、且实现已启用时，Core SHALL 使用 **Windows 文档化 API**（如 **`GetCursorPos`** 或等价）读取 **屏幕坐标**，作为命中输入。当该调用失败且未提供显式坐标时，响应 SHALL 返回可机读错误码（如 **`MOUSE_POSITION_UNAVAILABLE`**），且 SHALL NOT 返回 200 局部树。

#### Scenario: Win 指针不可用

- **WHEN** 未提供显式坐标且指针读取失败
- **THEN** 响应 SHALL 失败且 SHALL NOT 返回 200 局部树

## MODIFIED Requirements

### Requirement: 支持平台且会话就绪时提供按点局部无障碍接口

系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端在 **`process.platform === "darwin"` 或（实现就绪时的）`"win32"`**、会话 **`state === "running"`**、且存在 **非空 `pid`** 时，基于 **屏幕像素坐标** 获取 **无障碍局部子树** 快照（mac 为 AX；Windows 为 UIA 与/或 MSAA，以实现为准）。在未实现该能力的平台上，该接口 SHALL 失败并返回可机读错误码（如 **`PLATFORM_UNSUPPORTED`**），且 SHALL NOT 声称成功正文。

#### Scenario: 不支持的平台拒绝

- **WHEN** Core 运行在既非 darwin、也未启用 Win 实现的平台上且客户端调用该接口
- **THEN** 响应 SHALL 为 **4xx** 且 SHALL NOT 返回声称成功的局部无障碍正文

#### Scenario: 会话未运行或无 pid 时拒绝

- **WHEN** 会话未处于 `running` 或缺少 `pid`
- **THEN** 请求 SHALL 失败并返回可机读错误码（如 **`SESSION_NOT_READY`** / **`PID_UNAVAILABLE`**）

### Requirement: 坐标来源与指针读取约定

当请求 **未** 提供显式坐标参数时，在 **darwin** 上 Core SHALL 使用 **`@nut-tree/nut-js`** 的 **`mouse.getPosition()`**（或文档化等价 API）读取 **当前全局指针位置**；在 **win32** 上 SHALL 使用 **Windows API**（见 ADDED「Windows 上省略坐标时的指针来源」）。当 **显式** 提供合法 **`x`/`y`** 时，Core SHALL **优先**使用显式坐标（用于测试与调试）。

#### Scenario: 显式坐标优先

- **WHEN** 请求包含合法显式 `x`/`y`
- **THEN** 命中计算 SHALL 使用显式坐标，且 SHALL NOT 改用指针读取

### Requirement: 能力探测

`GET /v1/version` 的 **`capabilities`** 数组 SHALL 能表明是否支持 **`native_accessibility_at_point`**：**darwin 上**在功能已链接时列出；**win32 上**仅在 Windows 实现已就绪并可用时列出；其它未实现平台 SHALL NOT 列出或等价为不可用。

#### Scenario: 能力与实现一致

- **WHEN** Core 运行在 darwin 或（已启用的）win32 上且功能可用
- **THEN** `capabilities` 声明 SHALL 与接口实际可用性一致

### Requirement: Studio Qt 会话提供鼠标周围拉取

当会话 **`uiRuntime` 为 `qt`**、**`capabilities`** 包含 **`native_accessibility_at_point`** 且会话满足前置条件时，Studio SHALL 提供 **「捕获无障碍树（鼠标周围）」** 控件，触发上述 HTTP 请求，并以 **与整树一致或更易读** 的树状/折叠视图展示结果；失败时 SHALL 展示 Core 错误信息（含指针不可用、权限类、命中非会话进程类错误）。

#### Scenario: Qt 可触发鼠标周围拉取

- **WHEN** `uiRuntime` 为 `qt` 且能力与会话状态满足
- **THEN** 用户 SHALL 能使用该入口并成功看到结果或错误说明
