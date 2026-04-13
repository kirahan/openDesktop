## ADDED Requirements

### Requirement: 会话绑定且仅 macOS 提供原生无障碍树 HTTP 接口

系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端在会话 **`state === "running"`**、且会话记录存在 **非空子进程 `pid`** 时，请求 **macOS（darwin）** 上该 PID 对应进程的 **Accessibility（AX）UI 树** 的只读快照。系统 SHALL NOT 在非 darwin 平台声称该能力可用；在非 darwin 上调用该接口 SHALL 失败并返回可机读错误码（如 `PLATFORM_UNSUPPORTED`）。

#### Scenario: 非 macOS 拒绝

- **WHEN** Core 运行在非 darwin 平台且客户端调用该接口
- **THEN** 响应 SHALL 为 **4xx** 且 SHALL NOT 返回声称成功的 AX 树正文

#### Scenario: 会话未运行或无 pid 时拒绝

- **WHEN** 会话未处于 `running` 或缺少 `pid`
- **THEN** 请求 SHALL 失败并返回可机读错误码（如 `SESSION_NOT_READY` / `PID_UNAVAILABLE`），且 SHALL NOT 执行 AX 采集

### Requirement: AX 树 JSON 形态与规模上限

成功响应 SHALL 为 **JSON**，包含 **根节点对象** 及元数据字段（至少包括 **`truncated`** 布尔值，表示是否因上限截断）。每个节点 SHALL 至少包含 **`role`**（字符串，对应 AXRole 的人类可读或原始值）；SHALL 在可用时包含 **`title`**、**`value`**；子节点 SHALL 置于 **`children`** 数组中。系统 SHALL 支持通过查询参数限制 **`maxDepth`** 与 **`maxNodes`**（具备合理默认值与上限封顶），并在超过 **`maxNodes`** 时停止向下枚举并将 **`truncated`** 置为 **true**。

#### Scenario: 默认上限防止失控

- **WHEN** 目标应用存在极深或极宽的 AX 子树
- **THEN** 响应 SHALL 在达到节点或深度上限时停止扩展，且 **`truncated`** SHALL 为 **true**

### Requirement: 辅助功能权限失败可辨识

当系统因 **辅助功能（Accessibility）权限** 未授予而无法调用 AX API 时，响应 SHALL 为 **403**（或项目约定的权限类 4xx），且正文 SHALL 包含可机读错误码（如 **`ACCESSIBILITY_DISABLED`**）及面向用户的简短说明（指向系统设置授权路径）。系统 SHALL NOT 将此情况与「空树 / 应用未暴露控件」无差别地返回 **200**。

#### Scenario: 未授权与空树区分

- **WHEN** AX API 返回权限相关错误
- **THEN** 响应 SHALL 为权限失败语义（非 200），且 SHALL 与「200 + 空或极浅树」可区分

### Requirement: 能力探测

`GET /v1/version`（或项目统一的 **capabilities** 出口）SHALL 能表明 **当前 Core 是否支持** `nativeAccessibilityTree`（在 darwin 上为可用，其它平台为不可用）。客户端 MAY 据此隐藏或禁用相关 UI。

#### Scenario: macOS 构建声明支持

- **WHEN** Core 运行在 darwin 且已链接该功能
- **THEN** capabilities 中对该能力的声明 SHALL 与接口实际可用性一致

### Requirement: Studio Web 提供一键拉取与展示

**OpenDesktop Studio（`packages/web`）** SHALL 在会话观测相关界面提供 **「一键拉取原生无障碍树」** 控件：当 Core **`capabilities`** 表明 **`nativeAccessibilityTree`** 可用且用户选中的会话为 **`running`** 时，用户 SHALL 能通过该控件触发对上述 HTTP 接口的请求，并在页面内查看返回结果（**树状结构**或**可折叠/格式化的 JSON**，至少一种可读形式）。当能力不可用或会话非 **running** 时，该控件 SHALL 为 **禁用** 或 **隐藏**，并 SHALL 具备简短说明（如「仅 macOS」「会话未运行」）。当接口返回 **403** 且错误码表明 **辅助功能未授权** 时，界面 SHALL 向用户展示可操作的错误说明（含引导开启系统「辅助功能」权限的文案）。

#### Scenario: 能力可用且会话运行中可拉取

- **WHEN** `nativeAccessibilityTree` 为可用且当前选中会话 `state === "running"` 且有 `pid`
- **THEN** 一键拉取控件 SHALL 可点击，且 SHALL 发起请求并展示成功结果或错误信息

#### Scenario: 能力不可用或非运行会话

- **WHEN** 能力为不可用或非 `running` 会话
- **THEN** 一键拉取控件 SHALL 禁用或隐藏，且 SHALL NOT 误导用户发起必然失败的请求
