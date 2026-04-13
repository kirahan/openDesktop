# app-runtime-kind Specification

## Purpose

约定应用与会话上的 **`uiRuntime`（`electron` | `qt`）** 语义、API 暴露方式，以及 Studio 按运行时 **分流观测入口** 的行为，与 `app-register-bootstrap`、无障碍相关能力协同。

## Requirements

### Requirement: 应用定义包含 UI 运行时类型

系统 SHALL 在持久化的应用定义中支持字段 `**uiRuntime**`，取值为 `**electron**` 或 `**qt**`。当历史数据或请求中 **省略** 该字段时，系统 SHALL 按 `**electron**` 解释，以保持向后兼容。

#### Scenario: 省略字段时视为 Electron

- **WHEN** 已存应用记录或创建请求未包含 `uiRuntime`
- **THEN** Core SHALL 在逻辑上将其视为 `electron`，且 SHALL NOT 拒绝仅因缺字段而导致的合法读取

### Requirement: 注册与列表 API 暴露 uiRuntime

`POST /v1/apps` SHALL 接受可选字段 `**uiRuntime`**（`electron` | `qt`）。`GET /v1/apps` 返回的每个应用对象 SHALL 包含 `**uiRuntime`**（缺省时 SHALL 表现为 `electron` 或与默认值一致）。

#### Scenario: 创建 Qt 应用

- **WHEN** 客户端提交 `POST /v1/apps` 且 `uiRuntime` 为 `qt`
- **THEN** 持久化记录 SHALL 保存为 `qt`，且后续 `GET /v1/apps` SHALL 返回 `qt`

### Requirement: 会话列表附带 uiRuntime 供 Studio 分流

`GET /v1/sessions`（或项目约定的会话列表出口）返回的每个会话对象 SHALL 包含可直接用于 UI 分流的 `**uiRuntime`** 字段（或文档化且稳定的等价嵌套字段），其值 SHALL 由该会话关联 Profile 的应用定义解析得到。

#### Scenario: 会话继承应用的 Qt 标记

- **WHEN** 某会话对应应用的 `uiRuntime` 为 `qt`
- **THEN** 该会话在列表响应中的 `uiRuntime` SHALL 为 `qt`

### Requirement: Studio 应用列表展示运行时标签

**OpenDesktop Studio（`packages/web`）** 在应用列表或等价视图中 SHALL 为每条应用展示 **可区分 Electron 与 Qt** 的视觉标签（或文案），数据来源于 `**GET /v1/apps` 的 `uiRuntime`**。

#### Scenario: Qt 应用可见标签

- **WHEN** 某应用 `uiRuntime` 为 `qt`
- **THEN** 界面 SHALL 呈现与 Electron 可区分的标签或样式

### Requirement: Studio 会话观测区按 uiRuntime 分流

Studio SHALL 根据会话的 `**uiRuntime**` 渲染不同观测组件集合：

- `**electron**`：SHALL 保留现有以 CDP/语义层为主的观测入口（包括但不限于窗口列表、进程指标、态势快照等，以实现为准），并 MAY 继续提供整树原生无障碍能力（若平台与能力允许）。
- `**qt**`：SHALL **仅**将 **「原生无障碍树（整树）」** 与 **「捕获无障碍树（鼠标周围）」** 作为会话观测区的主要可操作入口（二者均须受平台与能力探测约束）；SHALL NOT 将仅适用于 Chromium 调试目标的观测作为 **同等优先级** 展示给用户（可隐藏或折叠为「不可用」说明）。

#### Scenario: Electron 会话保留多卡片

- **WHEN** 会话 `uiRuntime` 为 `electron`
- **THEN** 观测区 SHALL 展示与变更前一致的 Electron 观测能力集合（在能力与会话状态允许范围内）

#### Scenario: Qt 会话仅两主入口

- **WHEN** 会话 `uiRuntime` 为 `qt` 且 Core 声明支持相关无障碍能力且会话满足 running 与 pid 等前置条件
- **THEN** 用户 SHALL 能明确找到并操作「整树」与「鼠标周围」两类拉取动作，且 SHALL NOT 被要求优先使用 CDP 窗口列表作为 Qt 的主要观测路径
