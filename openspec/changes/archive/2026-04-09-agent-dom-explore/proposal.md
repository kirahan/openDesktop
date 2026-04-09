## Why

Agent 在规划「下一步点哪里」时，若只依赖原始 HTML 或让模型自由猜，噪声大、成本高且难复现。需要一种**只读**能力：在**当前页面 DOM 快照**上解析并筛出**较可能有实际意义的按钮类控件**，输出结构化列表；**不执行**点击、滚动等交互（由既有 `click`、`scroll`、`get` 等动词组合完成）。这样策略清晰、可测、与现有 Agent 架构一致。

## What Changes

- 新增 **canonical Agent 动词**（名称在设计中定稿，如 `explore`），请求体包含 `targetId`，可选参数用于限制数量、置信阈值等（设计细化）。
- Core 在**不触发页面内用户可见交互**的前提下，基于与现有 `get` 可比的 DOM 来源（或内部复用同一拉取路径），在 Node 侧做 HTML 解析与启发式筛选，返回 **候选控件列表**（至少含可展示标签、稳定定位线索、可选评分/原因码）。
- `GET /v1/version` 的 `agentActions` 列表包含新动词；CLI/OpenCLI 动词表与 README 对齐（若有同类文档）。
- **非目标**：不在本变更内实现 hover/click、不承诺等价于无障碍树的完备性。

## Capabilities

### New Capabilities

- `agent-dom-explore`：定义「DOM 只读解析 → 有意义按钮类候选列表」的行为契约、错误形态、与 `get`/会话状态的关系；明确 **SHALL NOT** 执行交互。

### Modified Capabilities

- （无）—— 不改变既有 `get`、`click` 等 spec 中的 requirement 文本；仅通过版本接口与 Agent 路由**扩展**能力。

## Impact

- **packages/core**：Agent 路由与 `registerObservability`（或现行分发点）、`agentActionAliases` / `SUPPORTED_AGENT_ACTIONS`、可能新增纯函数模块（HTML → candidates）及单元测试。
- **文档**：根目录 `README` Agent 动词表；必要时 `docs/PRODUCT.md` 一句说明。
- **对外 API**：`POST /v1/agent/sessions/:id/actions` 新 `action` 值；响应 JSON schema 在设计中固定。