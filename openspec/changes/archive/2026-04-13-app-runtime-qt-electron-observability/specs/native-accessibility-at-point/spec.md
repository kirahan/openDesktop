## ADDED Requirements

### Requirement: 仅 macOS 且会话就绪时提供按点局部 AX 接口

系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端在 **`process.platform === "darwin"`**、会话 **`state === "running"`**、且存在 **非空 `pid`** 时，基于 **屏幕像素坐标** 获取 **Accessibility 局部子树** 快照。在非 darwin 平台，该接口 SHALL 失败并返回可机读错误码（如 **`PLATFORM_UNSUPPORTED`**），且 SHALL NOT 声称成功正文。

#### Scenario: 非 macOS 拒绝

- **WHEN** Core 运行在非 darwin 平台且客户端调用该接口
- **THEN** 响应 SHALL 为 **4xx** 且 SHALL NOT 返回声称成功的局部 AX 正文

#### Scenario: 会话未运行或无 pid 时拒绝

- **WHEN** 会话未处于 `running` 或缺少 `pid`
- **THEN** 请求 SHALL 失败并返回可机读错误码（如 **`SESSION_NOT_READY`** / **`PID_UNAVAILABLE`**）

### Requirement: 坐标来源与 nut-js 约定

当请求 **未** 提供显式坐标参数时，Core SHALL 使用 **`@nut-tree/nut-js`** 的 **`mouse.getPosition()`**（或文档化等价 API）读取 **当前全局指针位置**，作为命中坐标。当 **显式** 提供坐标查询参数（或 JSON 字段，以实现为准）时，Core SHALL **优先**使用显式坐标（用于测试与调试）。

#### Scenario: 显式坐标优先于 nut-js

- **WHEN** 请求同时包含合法显式 `x`/`y` 与可用的 nut-js
- **THEN** 命中计算 SHALL 使用显式坐标

### Requirement: 局部树 JSON 形态与上限

成功响应 SHALL 为 **JSON**，至少包含：**命中节点**、**向上祖先链（受限深度）**、**向下子树（受限深度）**，并与现有整树节点形态 **兼容**（`role` / `title` / `value` / `children` 等字段语义一致）。系统 SHALL 支持查询参数限制 **`maxAncestorDepth`**、**`maxLocalDepth`**、**`maxNodes`**（具备合理默认值与硬上限），并在截断时包含 **`truncated: true`**。

#### Scenario: 截断可辨识

- **WHEN** 局部枚举触及节点或深度上限
- **THEN** 响应 SHALL 带 `truncated: true` 或文档化等价字段，且 SHALL NOT 静默无限扩展

### Requirement: 权限与辅助功能失败语义

当因 **辅助功能未授权** 或 AX API 权限类错误导致无法采集时，响应 SHALL 为 **403**（或项目约定权限类 4xx），且 SHALL 包含可机读错误码（如 **`ACCESSIBILITY_DISABLED`**）。当 **nut-js** 不可用或调用失败时，响应 SHALL 返回可机读错误码（如 **`MOUSE_POSITION_UNAVAILABLE`**），且 SHALL 在 **未** 提供显式坐标时 **不** 假装成功。

#### Scenario: nut-js 失败且无显式坐标

- **WHEN** 请求未带显式坐标且 `mouse.getPosition()` 失败
- **THEN** 响应 SHALL 失败并 SHALL NOT 返回 200 局部树

### Requirement: 能力探测

`GET /v1/version` 的 **`capabilities`** 数组 SHALL 能表明是否支持 **`native_accessibility_at_point`**（darwin 上可用时列出；其它平台 SHALL NOT 列出或等价为不可用）。

#### Scenario: 能力与实现一致

- **WHEN** Core 运行在 darwin 且已链接该功能
- **THEN** `capabilities` 声明 SHALL 与接口实际可用性一致

### Requirement: Studio Qt 会话提供鼠标周围拉取

当会话 **`uiRuntime` 为 `qt`**、能力可用且会话满足前置条件时，Studio SHALL 提供 **「捕获无障碍树（鼠标周围）」** 控件，触发上述 HTTP 请求，并以 **与整树一致或更易读** 的树状/折叠视图展示结果；失败时 SHALL 展示 Core 错误信息（含 nut-js 与权限类错误）。

#### Scenario: Qt 可触发鼠标周围拉取

- **WHEN** `uiRuntime` 为 `qt` 且能力与会话状态满足
- **THEN** 用户 SHALL 能点击「鼠标周围」并成功看到结果或错误说明
