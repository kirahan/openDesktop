## ADDED Requirements

### Requirement: 注册应用时可声明 uiRuntime

在 **`POST /v1/apps`** 创建应用时，客户端 MAY 提供 **`uiRuntime`** 字段（`electron` | `qt`）。当 **未提供** 时，系统 SHALL 采用 **`electron`** 作为默认值，以满足与既有「调用名即 id」等要求的兼容。

#### Scenario: 默认 electron 不破坏快乐路径

- **WHEN** 用户通过 `yarn oc app create` 或 Web 注册且未显式选择 Qt
- **THEN** 创建成功的应用 SHALL 表现为 `electron` 运行时分类，且 SHALL 满足 `app-register-bootstrap` 中既有唯一性与快乐路径要求

### Requirement: CLI 与 Web 注册路径可对齐 uiRuntime

CLI 与 Web SHALL 在文档化路径中支持将应用标为 **Qt**（例如 Web 下拉框、CLI 可选 flag），以便与 Studio 标签及观测分流一致；若某一路径暂不支持，SHALL 在文档中标注 **限制** 与 **变通**（例如创建后 `PATCH` 更新，若未来支持）。

#### Scenario: Web 可选择 Qt

- **WHEN** 用户在 Web 注册应用并选择 Qt
- **THEN** `POST /v1/apps` SHALL 携带 `uiRuntime: "qt"` 且成功持久化
