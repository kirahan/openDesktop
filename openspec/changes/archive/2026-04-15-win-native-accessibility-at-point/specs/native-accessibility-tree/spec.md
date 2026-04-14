# Delta: native-accessibility-tree

## RENAMED Requirements

- **FROM:** `### Requirement: 会话绑定且仅 macOS 提供原生无障碍树 HTTP 接口`
- **TO:** `### Requirement: 会话绑定且在支持平台上提供原生无障碍树 HTTP 接口`

## MODIFIED Requirements

### Requirement: 会话绑定且在支持平台上提供原生无障碍树 HTTP 接口

系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端在会话 **`state === "running"`**、且会话记录存在 **非空子进程 `pid`** 时，在 **`process.platform === "darwin"` 或（实现就绪时的）`"win32"`** 上请求该 PID 对应进程的 **无障碍 UI 树** 只读快照（mac 为 AX；Windows 为 UIA 与/或 MSAA，以实现为准）。系统 SHALL NOT 在未实现该能力的平台声称该能力可用；在未实现平台上调用该接口 SHALL 失败并返回可机读错误码（如 **`PLATFORM_UNSUPPORTED`**）。

#### Scenario: 不支持的平台拒绝

- **WHEN** Core 运行在既非 darwin、也未启用 Win 实现的平台上且客户端调用该接口
- **THEN** 响应 SHALL 为 **4xx** 且 SHALL NOT 返回声称成功的无障碍树正文

#### Scenario: 会话未运行或无 pid 时拒绝

- **WHEN** 会话未处于 `running` 或缺少 `pid`
- **THEN** 请求 SHALL 失败并返回可机读错误码（如 **`SESSION_NOT_READY`** / **`PID_UNAVAILABLE`**），且 SHALL NOT 执行树采集

### Requirement: 能力探测

`GET /v1/version`（或项目统一的 **`capabilities`** 出口）SHALL 能表明 **当前 Core 是否支持** **`native_accessibility_tree`**：**darwin 上**在功能已链接时列出；**win32 上**仅在 Windows 实现已就绪并可用时列出；其它未实现平台 SHALL NOT 列出或等价为不可用。

#### Scenario: 能力与实现一致

- **WHEN** Core 运行在 darwin 或（已启用的）win32 上且功能可用
- **THEN** `capabilities` 中对该能力的声明 SHALL 与接口实际可用性一致

### Requirement: Studio Web 提供一键拉取与展示

**OpenDesktop Studio（`packages/web`）** SHALL 在会话观测相关界面提供 **「一键拉取原生无障碍树」** 控件：当 Core **`capabilities`** 表明 **`native_accessibility_tree`** 可用且用户选中的会话为 **`running`** 时，用户 SHALL 能通过该控件触发对上述 HTTP 接口的请求，并在页面内查看返回结果（**树状结构**或**可折叠/格式化的 JSON**，至少一种可读形式）。当能力不可用或会话非 **running** 时，该控件 SHALL 为 **禁用** 或 **隐藏**，并 SHALL 具备简短说明（如「当前 Core 未提供该能力」「会话未运行」）。当接口返回 **403** 且错误码表明 **辅助功能未授权** 时，界面 SHALL 向用户展示可操作的错误说明（含面向各平台的权限引导文案，以实现为准）。

#### Scenario: 能力可用且会话运行中可拉取

- **WHEN** **`native_accessibility_tree`** 为可用且当前选中会话 `state === "running"` 且有 `pid`
- **THEN** 一键拉取控件 SHALL 可点击，且 SHALL 发起请求并展示成功结果或错误信息

#### Scenario: 能力不可用或非运行会话

- **WHEN** 能力为不可用或非 `running` 会话
- **THEN** 一键拉取控件 SHALL 禁用或隐藏，且 SHALL NOT 误导用户发起必然失败的请求
