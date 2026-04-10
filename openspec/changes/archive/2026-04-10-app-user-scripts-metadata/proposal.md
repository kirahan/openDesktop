## Why

需要在 **按应用（app）归属** 的前提下，为用户自定义脚本提供 **与油猴类似的元数据表达能力**（含 `@match` 等），并 **持久化** 脚本内容，为后续「按 URL 注入 / 自动执行」打基础。当前阶段 **不实现** `@match` 的运行时匹配与注入逻辑：一方面控制范围，另一方面 **SPA 客户端路由跳转后若不发生完整文档导航，则基于「页面 URL」的 match 天然不可靠**，需在后续专门设计后再实现。

## What Changes

- 引入 **按 app 归属的用户脚本** 概念：脚本文本 + 解析后的结构化元数据（**必须保留 `@match` 等字段的存储**，即使暂无消费方）。
- 提供 **UserScript 块解析**（`// ==UserScript==` … `// ==/UserScript==`），至少支持：`@name`、`@namespace`、`@version`、`@description`、`@author`、**多条 `@match`**、`@grant`（本阶段仅接受 `none` 或等价「无特权」声明，与「不做 GM 兼容」一致）。
- **不包含**：根据 `@match` 过滤 URL、新文档自动注入、CDP 执行脚本、SPA/hash 路由后的匹配刷新；上述列为 **明确延后**，并在设计与 spec 中写明 **已知限制（SPA）**。

## Capabilities

### New Capabilities

- `app-user-scripts`：定义按 app 存储用户脚本、解析并持久化 UserScript 元数据（含 `@match` 字段）；声明本阶段 **不**根据 `@match` 执行任何路由或注入逻辑，并记录 SPA 与 match 的结构性矛盾，供后续变更引用。

### Modified Capabilities

- （无）根目录既有能力无 REQUIREMENT 级行为变更；本变更为新增能力。

## Impact

- **数据**：每个注册 app 下脚本的存储布局与 schema（与现有 `dataDir`/profile 体系对齐，细节见 design）。
- **Core**：新增或扩展 HTTP API（或等价管理面）用于脚本的 CRUD/列表；解析器模块与单元测试。
- **Studio / CLI**：可选；本提案以 **契约与持久化** 为主，UI 可在后续任务或变更中追加。
