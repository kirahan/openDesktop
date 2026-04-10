# app-user-scripts-injection

## 概述

**一句话**：为已持久化的用户脚本提供 **按会话、显式触发** 的 CDP 注入能力：将会话所属 `appId` 下全部脚本 **正文** 注入到 **当时枚举到的全部 CDP `page` target**，**不**根据 `@match` 或 URL 筛选。

**背景与动机**：用户脚本仅能存储时无法在页面中验证 `console.log` 等行为；需在受控调试链路上执行脚本。采用 **读法 A**：不按 URL 匹配，对适用 `page` target 全量注入，避免首版陷入 SPA / glob 匹配复杂度。

**影响范围**：`packages/core`（CDP、HTTP、测试）、根 `README`；可选 `packages/web` Studio 按钮。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件 |
|---|------|------|---------|
| 1 | 注入管线 | 读 `user-scripts`、按 `appId` 取 body 列表、CDP 枚举 `page` target、逐 target `Runtime.evaluate` | `packages/core/src/cdp/*`、`userScripts/*` 或新模块 |
| 2 | HTTP API | `POST /v1/sessions/:sessionId/user-scripts/inject`，Bearer，`allowScriptExecution` gate | `packages/core/src/http/createApp.ts` |
| 3 | 测试 | HTTP 集成测试覆盖 403、非 running、空脚本、成功 | `packages/core/src/http/*userScript*inject*.test.ts` 或扩展现有 |
| 4 | 文档 | README 用户脚本小节 | `README.md` |
| 5 | Studio（可选） | 按钮触发注入 | `packages/web/src/App.tsx` |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|---------------------|
| 触发方式 | 显式 POST，首版不自动随导航重注入 | 可测、安全心智清晰；自动重注入留后续 |
| Target 范围 | CDP `page` 类型全部 target | 覆盖 iframe；仅主窗口会漏 |
| URL / `@match` | 不参与注入决策 | 用户确认的读法 A |
| 执行模型 | 单次请求内 `Runtime.evaluate` 各 body | 与现有 CDP 封装一致；addScriptToNewDocument 留后续 |
| 权限 | 与 `allowScriptExecution` 对齐 | 与 Agent/Recipe 等脚本能力一致 |

### 技术要点

- 会话 → Profile → `appId`（已有 session manager 关系）。
- 解析 body：已有 `parseUserScriptSource` 的 `body` 字段。
- CDP：`Target.getTargets` 过滤 `type === "page"`，对每个 target attach 后执行注入。
- 多脚本顺序：实现选一种稳定顺序（如 `id` 字典序）并写进代码注释或 README。

## 验收标准

> 测试和产品验收以本节为准（与 delta spec 一致）。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | `@match` 不参与 | 脚本含任意 `@match`，调用注入 API | 不因 URL/match 跳过 target 或脚本 |
| 2 | 未注入不执行 | 仅 CRUD，不调用注入 | 不因会话运行而自动执行 body |
| 3 | Profile 禁止脚本 | `allowScriptExecution === false`，调用注入 | 403 + 统一错误码，不执行 |
| 4 | 会话未就绪 | 非 `running` 或 CDP 不可用 | 失败可机读，不声称成功 |
| 5 | 无脚本 | `appId` 下 0 条脚本，调用注入 | 2xx，条数 0，非 404（会话存在时） |
| 6 | 成功路径 | 至少 1 个 `page` target 且 ≥1 条脚本 | 每 target 尝试执行注入管线，body 进入页面 JS 环境 |
| 7 | 文档 | 读 design + README | 显式注入、`@match` 不参与、多 target 可能重复执行均有说明 |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | 注入管线 + CDP | body 列表 + page targets + evaluate | — |
| 2 | HTTP API + 测试 | POST inject、错误映射、http 测试 | 1 |
| 3 | README | 使用者说明 | 2 |
| 4 | Studio 按钮（可选） | 调 API | 2 |
| 5 | 归档合并主规格 | reconcile `app-user-scripts` | 2 |

## 测试要点

- `allowScriptExecution: false` 必测；与既有 `SCRIPT_NOT_ALLOWED` 断言一致。
- 无脚本与有脚本的成功语义区分。
- 回归：既有 user-scripts CRUD、`@grant none` 校验不受影响。
