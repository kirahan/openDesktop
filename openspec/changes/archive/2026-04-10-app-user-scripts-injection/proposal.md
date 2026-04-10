## Why

用户脚本已能按 `appId` 持久化，但**不会在调试目标中执行**，无法在页面上下文验证 `console.log` 等行为。需要在 **CDP 受控、与既有会话模型一致** 的前提下，提供 **按会话触发、对该 app 下全部适用 target 注入** 的能力；本阶段 **不实现** `@match` 与 URL 的匹配语义，避免 SPA / 路由复杂度阻塞首版落地。

## What Changes

- 新增经鉴权的 **会话级注入入口**（HTTP，路径以 `design.md` 为准）：在会话 `running` 且 CDP 可用时，将 **该会话 Profile 所属 `appId`** 下 **全部**用户脚本的 **正文**（元数据块外的 body）注入到 **文档化范围内的全部 CDP `page` 类型 target**（不按 URL / `@match` 筛选）。
- **注入决策 SHALL NOT 参考**已存储的 `metadata.matches`；`@match` 继续仅作存储与展示。
- 与既有 **`allowScriptExecution`** 对齐：禁止脚本执行时注入 SHALL 失败（403 / 项目统一错误码）。
- **Non-goal（本变更不包含）**：`GM_*` API、`@match` 模式匹配、按导航自动重注入、worker / non-page target 的完整覆盖（除非 `design.md` 明确写入）。
- Studio（`packages/web`）**可选**：提供「对当前会话注入」按钮并调用新 API（若任务排期允许；否则可在后续小变更补 UI）。

## Capabilities

### New Capabilities

（无独立新 capability 名称；行为作为 `app-user-scripts` 的能力扩展，见下方 Modified。）

### Modified Capabilities

- **`app-user-scripts`**：删除「本阶段完全不发生注入」的规范性表述，改为 **「`@match` 不参与注入决策」** + **「显式会话级注入」** 的 ADDED/REMOVED delta（见 `specs/app-user-scripts/spec.md`）。合并至主规格时，主文件 `openspec/specs/app-user-scripts/spec.md` 将同步更新。

## Impact

- **Core**：`packages/core` HTTP 路由、CDP 客户端（`browserClient` 或新模块）、会话上下文（`appId` ← Profile）、与 `jsonStore` 读取 `user-scripts` 的衔接；单元/HTTP 测试。
- **Web（可选）**：`App.tsx` 会话详情附近增加注入触发与结果提示。
- **文档**：README 用户脚本小节补充「显式注入」说明。
- **Breaking**：无（新增 API；既有 user-scripts CRUD 不变）。
