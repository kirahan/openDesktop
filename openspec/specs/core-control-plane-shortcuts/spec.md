# core-control-plane-shortcuts Specification

## Purpose

定义 Core 对 **Electron 全局快捷键闭集动作** 的 HTTP 控制面：主进程或任意第三方客户端在 **Bearer 鉴权** 下调用 **同一会话** 内的录制启停、打点等能力，**业务编排仅在 Core 内** 完成，与 Studio Web 是否运行无关。

## Requirements

### Requirement: 提供会话级全局快捷键控制面端点

系统 SHALL 提供文档化 **`POST`** 路由，路径包含 **`/v1/sessions/:sessionId/`** 与固定后缀（例如 **`control/global-shortcut`**，确切字符串以实现与 `design.md` 为准），且 SHALL 要求 **`Authorization: Bearer`** 与现有 v1 API 一致。

请求体 SHALL 包含 **`actionId`** 字符串，取值 SHALL 为闭集之一（至少包含：`vector-record-toggle`、`segment-start`、`segment-end`、`checkpoint`，命名与现有 `studioGlobalShortcuts` 对齐或文档化映射表）。

系统 SHALL 在 Core 内将 `actionId` 编排为对既有录制 / 打点服务的调用，SHALL NOT 要求请求来自浏览器渲染进程。

#### Scenario: 合法 Bearer 与有效 session 时接受请求

- **WHEN** 客户端使用有效 Bearer 向控制面发送已知 `actionId`，且 `sessionId` 对应会话在 Core 中存在并处于允许操作的状态
- **THEN** Core SHALL 返回 **`2xx`** 且 body SHALL 包含结构化结果（至少包含整体 `ok` 或逐项 `results`，以实现为准），且 SHALL 执行与该 `actionId` 等价的业务效果

#### Scenario: 缺少或非法 Bearer

- **WHEN** 请求未携带 Bearer 或 token 无效
- **THEN** Core SHALL 返回 **`401`** 或文档化等价错误，且 SHALL NOT 修改录制状态

#### Scenario: 未知 actionId

- **WHEN** `actionId` 不在闭集内
- **THEN** Core SHALL 返回 **`400`** 与可机读错误码（例如 `VALIDATION_ERROR`），且 SHALL NOT 执行部分业务

### Requirement: 批量 target 与部分失败可观测

当 `actionId` 隐含对 **多个 `targetId`** 操作时（例如矢量录制对同会话多窗），系统 SHALL 在响应中 **逐项** 报告每个 `targetId` 的成功或失败；若部分因 **`PARALLEL_LIMIT_EXCEEDED`** 等失败，SHALL 返回 **`207`** 或文档化状态码，且 body SHALL 能区分成功项与失败项。

#### Scenario: 并行上限导致部分 target 未启动

- **WHEN** 批量启动矢量录制时部分 `targetId` 因并发上限被拒绝
- **THEN** 响应 SHALL 标明失败项及错误码，且已成功启动的 target SHALL 保持录制活跃

### Requirement: 与既有单 target 录制 API 行为等价

控制面对 `vector-record-toggle` 等与 **`POST /v1/sessions/:sessionId/replay/recording/start|stop`**、**`.../ui-marker`** 的语义 SHALL **一致**（同一 session/target 下最终状态与直接调用单 target API 相同），除非文档化说明有意差异。

#### Scenario: 重复启动幂等或可机读

- **WHEN** 控制面请求对已在录的 target 再次「启动」
- **THEN** 行为 SHALL 与直接调用现有 `recording/start` 的幂等策略一致（实现可返回 `409` 或 `ok` 已存在，须在响应中可区分）
