# app-register-bootstrap Specification

## Purpose

约定应用注册时的调用名、唯一性校验、短 id 生成，以及 `**yarn oc app create**` 一条命令完成应用加默认 Profile 与可选会话的快乐路径；Web 与 CLI 行为对齐，便于 App-first 使用。

用户可见术语（主路径强调「应用」与「会话」、弱化 Profile）见 `openspec/specs/ux-app-session-terminology/spec.md`。

## Requirements

### Requirement: 调用名即 App id 且与 App-first 一致

用户在注册应用时提供的 **应用标识（调用名）** SHALL 作为 Core 中 `AppDefinition.id` 存储；该字符串 SHALL 与 `yarn oc <appId> <子命令>` 中的 `<appId>` 使用同一命名空间与匹配规则。文档与注册界面 MUST 将该字段标注为必填（除非产品明确允许「仅自动生成」流程），并说明其用于命令行 App-first 调用。

#### Scenario: 文档与表单说明调用名用途

- **WHEN** 用户阅读应用注册相关文档或打开 Web 注册表单
- **THEN** 可见该标识用于 `oc` App-first 形式中的 `<appId>`（或项目所用等价 CLI 入口）

### Requirement: 注册前校验应用 id 未被占用

在发起 `POST /v1/apps` 创建新应用之前，CLI 与 Web SHALL 通过 `GET /v1/apps`（或等价只读列表能力）检查目标 `id` 是否已存在于返回列表中；若已存在，则 SHALL NOT 发送创建请求，并 MUST 向用户展示明确错误信息（提示更换 id）。

#### Scenario: CLI 重复 id 被拒绝

- **WHEN** 用户指定的应用 id 已出现在当前 Core 应用列表中
- **THEN** 快乐路径注册命令以非零退出码结束，且 stderr 或 stdout 中包含「已存在」或等价语义

#### Scenario: Web 重复 id 被拒绝

- **WHEN** 用户在表单中提交的应用 id 已存在
- **THEN** 界面显示错误且未完成创建（不依赖仅依赖 HTTP 409 作为唯一手段）

### Requirement: 简化自动生成应用 id

当产品流程需要「自动生成」应用 id 时，生成规则 SHALL 产生 **较短、可读** 的标识：由可打印 slug（来自可执行路径或文件名）与 **短后缀** 组成；后缀长度 SHALL 不超过 6 个字符（字母数字），且 SHALL NOT 默认使用 8 位十六进制作为唯一形态。生成后仍须满足本 spec 中唯一性校验要求。

#### Scenario: 自动生成结果长度可控

- **WHEN** 系统为某次注册自动生成应用 id
- **THEN** 完整 id 字符串长度合理（建议不超过 32 个字符，具体以实现为准），且包含可读 slug 部分

### Requirement: 快乐路径一次注册默认 Profile 与可选会话

项目 SHALL 通过 `**yarn oc app create`**（或文档化等价入口）在单次用户 invocation 中顺序完成：创建应用、创建**默认** Profile（绑定该 `appId`）、以及可选地创建会话。默认 Profile 的 `id` 命名规则 SHALL 在文档中固定（例如 `{appId}-default`）。若某步返回 409（资源已存在），行为 SHALL 在文档中定义为「跳过并继续」或「失败退出」之一，且须一致实现。

#### Scenario: 完整链路成功

- **WHEN** 用户在 Core 可达且 token 有效的情况下执行快乐路径命令，且应用 id 未被占用
- **THEN** 应用与默认 Profile 被创建；若启用启动选项则创建新会话（或达到等价可观测状态）

#### Scenario: 跳过启动会话

- **WHEN** 用户使用关闭「启动会话」的选项执行快乐路径命令
- **THEN** 应用与默认 Profile 被创建，但不创建新会话

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