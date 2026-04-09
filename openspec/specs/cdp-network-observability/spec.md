## Requirements

### Requirement: 按窗口采集 HTTP(S) 请求元数据

系统 SHALL 在具备有效会话与 `targetId`、且 CDP 可用的前提下，在调用方指定的 **时间窗口**（毫秒，上下限由实现文档化）内，对该 target 启用 CDP `Network` 域并采集该渲染上下文中发起的 HTTP 或 HTTPS 请求的元数据：至少包含 **请求方法**、**资源 URL**（或经 strip 后的形式）、**HTTP 状态码**（若可得）、**起止时间与耗时**。系统 SHALL NOT 声称采集 **未** 经该 target 网络栈发出的流量（例如 Electron 主进程直连请求）。

#### Scenario: 窗口内成功返回聚合结果

- **WHEN** 客户端调用文档约定的 Agent 动作（canonical：`network-observe`），提供有效 `targetId` 与合法 `windowMs`，且窗口内至少有一条可观测请求完成
- **THEN** 响应 JSON SHALL 包含 `totalRequests`（非负整数）及实现文档化的耗时与并发相关字段；SHALL NOT 返回 HTTP 200 却无任何观测字段

#### Scenario: 会话或 CDP 不可用

- **WHEN** 会话不存在、未运行、或无法附加目标
- **THEN** 响应为失败状态，错误类别与现有 Agent 动作可映射；SHALL NOT 静默成功

### Requirement: 聚合统计与慢请求呈现

系统 SHALL 在聚合结果中提供 **时间窗口内请求发起数**（`totalRequests`）与 **已完成请求数**（`completedRequests`）；SHALL 提供 **最大并发未完成请求数**（`maxConcurrent`，`requestId` 生命周期内 in-flight 峰值）。系统 SHALL 提供 **慢请求** 列表（`slowRequests`）：耗时超过可调阈值（含默认值）的若干条（条数上限文档化），每条含 URL 与耗时。

#### Scenario: 慢请求阈值

- **WHEN** 调用方指定 `slowThresholdMs`（若实现支持）或采用默认阈值
- **THEN** `slowRequests` 中的记录 SHALL 仅包含耗时不低于该阈值的已完成请求（在元数据完整的前提下）

### Requirement: 规模与隐私边界

系统 SHALL 对单响应中返回的 URL 条数、单 URL 字符串长度、总 JSON 大小施加上限或截断策略；MAY 对 query string 做剥离或哈希。MVP **不要求** 记录 request/response body。

#### Scenario: 超限截断

- **WHEN** 窗口内请求条数超过实现设定的最大保留条数
- **THEN** 响应 SHALL 标明截断（例如 `truncated: true`）或等价机读字段，且 SHALL NOT 无提示丢弃全部数据

### Requirement: 可发现性

当 Agent API 启用且本能力已实现时，`GET /v1/version` 返回的 `agentActions` SHALL 包含 canonical 动词 `network-observe`。

#### Scenario: 版本列表包含新动词

- **WHEN** 客户端请求 `GET /v1/version`
- **THEN** `agentActions` 包含 `network-observe`
