# session-replay-multi-target Specification

## Purpose

定义 **同一会话（session）下多调试 target 并行录制** 的规范性要求：事件归属、合并时间线、分段与检查点存储，以及 Studio 在合并视图与分轨视图上的展示一致性。

## Requirements

### Requirement: 同会话多 target 并行录制

系统 SHALL 允许在同一 `sessionId` 下，**不少于一个** `targetId` 同时处于**录制活跃**状态（并行），前提是实现对该会话的资源与并发上限策略（见 design）。系统 SHALL NOT 在无明确错误原因时静默拒绝第二个 target 的录制启动请求。

#### Scenario: 第二个 target 在首个仍在录制时启动

- **WHEN** `targetId=A` 已在该 `sessionId` 下处于矢量录制活跃状态，且客户端请求对 `targetId=B` 启动同类录制
- **THEN** 系统 SHALL 使 `B` 进入录制活跃状态或返回**可机读**错误（例如超出并发上限）；SHALL NOT 在未声明策略时隐式停止 `A`

#### Scenario: 单 target 仍为合法特例

- **WHEN** 仅存在一个 `targetId` 处于录制活跃状态
- **THEN** 系统行为 SHALL 与本变更前单 target 语义兼容（相同前置条件下与现有实现对齐）

### Requirement: 录制事件必须携带 targetId

对于纳入 **合并时间线** 与/或 **矢量 NDJSON/SSE** 的 **输入类** 录制事件（如指针、键盘、滚轮等，具体集合以实现 schema 为准），系统 SHALL 在事件载荷中包含 **`targetId`**。系统 SHALL NOT 在仅依赖 **操作系统前台窗口** 或 **Studio 焦点** 的情况下推断 `targetId` 作为**唯一**归属依据。

#### Scenario: 事件载荷含 targetId

- **WHEN** 系统向客户端或存储层输出一条输入类录制事件
- **THEN** 该条载荷 SHALL 包含非空 `targetId` 字段（或文档化等价字段名）

#### Scenario: 禁止纯焦点推断为规范路径

- **WHEN** 实现需要确定某条输入事件的归属 target
- **THEN** 规范路径 SHALL 为采集路径在事件产生时已绑定之 `targetId`；SHALL NOT 将「当前焦点窗口」作为**唯一**依据写入规范要求（调试降级若在 design 中允许，须单独标注且默认关闭）

### Requirement: 可选稳定窗口标识

当产品需要区分**同应用内**多个 `BrowserWindow` 且无法仅由 `targetId` 表达时，系统 SHALL 支持在事件或 target 元数据中携带 **稳定窗口标识**（名称由实现定义，如 `windowLabel`）。若未启用该能力，则 **仅 `targetId`** 即可满足本 spec。

#### Scenario: 启用窗口元数据时一并存储

- **WHEN** 客户端或 Core 为某 target 登记了窗口标识
- **THEN** 该 target 的后续事件 MAY 包含该标识；合并与回放 SHALL 不丢失该字段（若实现选择持久化）

### Requirement: 每 target 单调时间与序列

系统 SHALL 为每个 `targetId` 的采集流维护 **单调非递减** 的时间戳 `monoTs` 与 **每 target 递增** 的整数序列 `seq`（或等价物），并在每条事件中携带，用于合并排序与去歧义。

#### Scenario: 同毫秒内多事件可区分

- **WHEN** 同一 `targetId` 在相同 `monoTs` 下产生两条事件
- **THEN** 两条事件 SHALL 可通过 `seq` 或等价序列区分全序

### Requirement: 合并全序时间线

系统 SHALL 提供将多 target 事件合并为 **全序** 时间线的规则：全序键 SHALL 至少包含 `(mergeTs, targetId, seq)`，其中 `mergeTs` 由实现依据 design 从会话锚点与各 target `monoTs` 导出；`targetId` 与 `seq` 作为 tie-break。系统 SHALL 文档化 `mergeTs` 的计算方式。

#### Scenario: 合并顺序可复现

- **WHEN** 给定同一批带 `targetId`、`monoTs`、`seq` 的事件集合
- **THEN** 合并结果顺序 SHALL 确定性（相同输入产生相同全序）

### Requirement: 入点、出点、检查点的存储与作用域

系统 SHALL 支持将 **入点**、**出点**、**检查点** 存储为包含：**合并时间**（对齐全序时间线，`mergedTs` 或文档化字段）、**作用域 `scope`**（`session` 或 `target`）。当 `scope` 为 `target` 时，载荷 **必须**包含 `targetId`。

#### Scenario: target 作用域检查点

- **WHEN** 用户或 API 创建一条 `scope=target` 的检查点
- **THEN** 存储层 SHALL 拒绝缺少 `targetId` 的请求并返回可机读错误

#### Scenario: session 作用域入点

- **WHEN** 用户创建一条 `scope=session` 的入点
- **THEN** 该标记 SHALL 出现在会话级合并时间线上，且 SHALL NOT 隐含仅属于某一 target（除非额外字段说明）

### Requirement: Studio 合并视图与分轨视图展示一致

Studio SHALL 在 **合并时间线** 视图与 **按 target 分轨** 视图中展示同一组标记时，保持 **语义一致**：同一 `mergedTs` 的标记在不同视图中 **不得** 互相矛盾；若某视图因 `scope` 隐藏某标记，SHALL 提供可发现性（如图例说明「仅在分轨显示」或等价）。

#### Scenario: 检查点在两种视图中可对应

- **WHEN** 用户在同一 session 打开合并视图与分轨视图
- **THEN** 同一检查点 ID 或时间戳 SHALL 可在两视图间对应（允许视觉样式不同，不得语义冲突）

### Requirement: 并发与错误可观测

当并行 target 数超过实现上限或资源失败时，系统 SHALL 返回 **可机读** 错误码或原因；SHALL NOT 静默丢弃已采集事件。

#### Scenario: 超出上限

- **WHEN** 客户端请求超出文档化并发上限的并行录制
- **THEN** 系统 SHALL 返回明确错误且 SHALL NOT 假装成功
