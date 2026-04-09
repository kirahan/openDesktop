## Requirements

### Requirement: 网络观测 SSE 端点

在会话处于 `running`、CDP 可用且请求提供有效 `targetId` 时，系统 SHALL 提供经鉴权的 **HTTP GET + SSE**（`Content-Type: text/event-stream`），使客户端能够订阅该 target 在 **订阅建立之后** 新产生的、与 CDP `Network` 域一致语义的 **HTTP(S) 请求元数据** 事件流。系统 SHALL NOT 声称回放连接建立前已发生的请求历史。系统 SHALL NOT 在 SSE 中传输 request/response **body**（与短时 `network-observe` 边界一致）。

#### Scenario: 订阅就绪后推送新请求事件

- **WHEN** 客户端已建立网络 SSE 且目标页面在订阅后发起新的 HTTP(S) 请求且 CDP 可观测到元数据
- **THEN** 客户端在合理延迟内收到至少一条 `data` 事件，其 JSON 至少包含可机读的 **方法与 URL**（或经 strip 后的 URL）及与实现文档一致的 **耗时或阶段** 字段

#### Scenario: 会话不可用

- **WHEN** 会话不存在、非 `running` 或 CDP 未就绪
- **THEN** 服务器返回文档化的错误状态（如 404/503）且 SHALL NOT 建立仅挂起无 `ready` 的长连接

### Requirement: 网络 SSE 数据量与背压

系统 SHALL 对单路网络 SSE 实施 **并发连接层面的限制**（与控制台 SSE 分流或共用配额由实现文档化，但 SHALL 定义明确上限）。系统 SHALL 对事件推送实施 **速率或条数上限**（或等价 token 桶）；当必须丢弃事件时，系统 SHALL 以 **可机读方式** 告知客户端（例如 SSE `event: warning` 或 `data` 内 `droppedEvents` 累计字段定期更新），且 SHALL NOT 在持续超限情况下无提示地丢弃全部事件流。系统 SHALL 对单条事件 JSON 大小与 URL 字符串长度施加上限或截断策略；MAY 默认剥离 query/hash 与短时 `network-observe` 的 `stripQuery` 行为对齐。

#### Scenario: 超出并发连接上限

- **WHEN** 已存在达到实现定义上限的并发网络 SSE 连接，新的合法订阅请求到达
- **THEN** 服务器返回 **429**（或文档约定的冲突状态）及可解析错误码，且 SHALL NOT 建立新流

#### Scenario: 速率超限需可感知

- **WHEN** 在短时间窗口内可观测请求事件数超过实现定义的推送上限
- **THEN** 服务器 MAY 丢弃部分事件，但 SHALL 使客户端能够区分「无流量」与「有流量但被限流」，且 SHALL 累计或周期性暴露丢弃量或等价警告

### Requirement: 运行时异常栈 SSE 端点

在会话 **`allowScriptExecution` 为 true**、会话 `running`、CDP 可用且提供有效 `targetId` 时，系统 SHALL 提供经鉴权的 **GET + SSE**，推送 **订阅建立之后** 捕获的 **未处理运行时异常** 及与现有 `runtime-exception` action 对齐的 **栈帧**（`functionName` / `url` / `lineNumber` / `columnNumber` 等）。系统 SHALL NOT 声称提供连接建立前的异常历史。

#### Scenario: 脚本允许时订阅成功并收到异常

- **WHEN** `allowScriptExecution` 为 true 且目标页在订阅后抛出可经 CDP 观测的异常
- **THEN** 客户端收到至少一条包含异常文本与栈帧数组的 `data` 事件（字段命名可与 action 响应一致以便复用客户端逻辑）

#### Scenario: 脚本不允许

- **WHEN** 会话 `allowScriptExecution` 为 false
- **THEN** 服务器返回 **403** 及可机读原因（与 `runtime-exception` action 的 `SCRIPT_NOT_ALLOWED` 语义一致），且 SHALL NOT 建立推送异常内容的 SSE

### Requirement: 异常 SSE 资源上限

系统 SHALL 对运行时异常 SSE 的 **并发连接数** 施加上限（可与网络 SSE 分表或合并为「可观测 SSE」总池，须文档化）。系统 MAY 对单位时间内推送的异常条数施加上限；超限时 SHALL 采用可机读的警告或丢弃计数策略，且 SHALL NOT 静默无提示地永久吞掉全部异常。

#### Scenario: 并发超限

- **WHEN** 异常 SSE 并发数达到实现定义上限
- **THEN** 新请求收到 **429** 或可解析错误，且不建立新连接

### Requirement: 订阅生命周期

系统 SHALL 在客户端断开 HTTP 连接时 **释放** 该路 SSE 占用的 CDP 监听资源与并发名额。系统 SHALL 在流开始时发送 **`event: ready`**（或与 `console/stream` 对齐的等价约定），其 `data` JSON SHALL 包含 `sessionId`、`targetId` 及说明 **无历史** 的 `note`。发生不可恢复错误时，系统 SHOULD 发送 **`event: error`** 后结束响应。

#### Scenario: 断开即释放

- **WHEN** 客户端主动关闭 TCP 连接
- **THEN** 服务器侧该 target 的订阅被拆除，且后续可再次成功建立新订阅（在其余条件满足时）

### Requirement: 可发现性

当 Agent API 或相关 HTTP API 启用且本能力已实现时，`GET /v1/version` SHALL 包含 **可机读字段**，枚举或列出可用的 **可观测 SSE** 能力（至少区分 **network** 与 **runtime-exception** 两类），以便客户端无需硬编码路径。

#### Scenario: 版本信息包含 SSE 能力

- **WHEN** 客户端请求 `GET /v1/version` 且构建启用了本能力
- **THEN** 响应 JSON 中存在文档化字段，指示网络与运行时异常 SSE 可用（字段名与取值格式与 `design.md` / README 一致）

### Requirement: App-first CLI 与观测能力对齐（可选交付物）

本变更所涉 **网络 / 控制台 / 异常栈** 的短时采样与 **GET + SSE** 长流，SHALL 在 OpenDesktop CLI（`od` / workspace `yarn oc`）中可通过 **App-first** 形式调用，且子命令与 **HTTP API** 的对应关系 SHALL 与 `design.md` 中「App-first CLI」表格一致，便于与 `curl -N` 并列使用。

#### Scenario: 帮助信息列出子命令

- **WHEN** 用户执行根命令的 `--help`（或项目约定的 `yarn oc --help`）
- **THEN** 帮助文本中 App-first 说明 SHALL 包含 `network-observe` / `network-stream` 及与控制台、异常栈相关的 `console-observe` / `console-stream` / `stack-observe` / `stack-stream`（命名以 `design.md` 为准），并 SHALL 区分短时 JSON 与 SSE 长流（含 `--wait-ms`、不适用 `--format` 于 SSE 等关键提示）

#### Scenario: 解析与路由可测

- **WHEN** 维护者运行针对 CLI 解析与 `runAppFirst` 的单元测试
- **THEN** 测试 SHALL 覆盖上述子命令至少一条成功路径（mock HTTP），避免回归破坏 App Id → 会话解析 → 正确 Verb 的映射
