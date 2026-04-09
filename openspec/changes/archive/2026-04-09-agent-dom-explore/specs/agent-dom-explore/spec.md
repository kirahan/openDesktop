## ADDED Requirements

### Requirement: Agent 动词 explore（只读 DOM 候选）

Core SHALL 提供 canonical Agent 动词 `explore`。在会话可附加 CDP 且能取得与现有 `get` 动作可比的页面 HTML 快照时，Core SHALL 在**服务端进程内**对该 HTML 进行解析，并返回一组**按钮类可交互控件候选**（启发式筛选）；Core SHALL NOT 通过本动作执行点击、输入、滚动或其它使用户可见交互或修改页面状态的操作。

#### Scenario: 成功返回候选列表

- **WHEN** 客户端 `POST /v1/agent/sessions/:sessionId/actions` 的 body 包含 `"action": "explore"`、有效 `targetId`，且 DOM 快照可取得
- **THEN** 响应体为 JSON，包含 `candidates` 数组；每个元素 SHALL 包含人类可读 `label`（可为空字符串但须存在）与至少一种供后续操作使用的 `selector` 或项目文档约定的定位字段；MAY 包含 `score` 与 `reasons`

#### Scenario: 不包含页面交互

- **WHEN** 客户端调用 `explore`
- **THEN** Core 不因本请求对目标页执行点击、聚焦输入、滚动或其它 CDP 输入类命令；仅允许为取得与 `get` 一致的文档快照而发生的只读 CDP 调用（若与 `get` 共享实现）

#### Scenario: 动词出现在版本列表

- **WHEN** 客户端调用 `GET /v1/version` 且 Agent API 已启用
- **THEN** 返回的 `agentActions` 列表包含 `explore`

### Requirement: 错误与边界

当会话不可用、目标无效、或 DOM 快照无法取得时，系统 SHALL 返回与现有 Agent 动作一致的可机读错误响应；SHALL NOT 返回空 HTTP 200 且无语义字段冒充成功。

#### Scenario: 无法取得 DOM

- **WHEN** 与 `get` 相同的 DOM 拉取路径失败（如 CDP 错误）
- **THEN** 响应为失败状态，正文包含可解析错误信息，`candidates` 不作为成功结果返回

### Requirement: 列表规模与确定性

系统 SHALL 对返回候选数量施加上限（默认值或请求参数指定）；在同一 HTML 输入与相同参数下，筛选与排序结果 SHALL 确定（便于测试复现）。

#### Scenario: 数量上限

- **WHEN** 解析结果多于配置的上限
- **THEN** 响应仅包含不超过该上限的候选，且排序规则文档化（例如按 score 降序后截断）
