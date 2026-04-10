## Context

- 用户脚本源文与解析结果存于 `<dataDir>/user-scripts.json`，按 **`appId`** 列表；解析器已产出 **`body`**（`// ==UserScript==` 块外正文）。
- 会话 `SessionRecord` 含 `profileId`；Profile 绑定 **`appId`**（见 `session/manager`）。CDP 端口在会话 **`running`** 时可用。
- 既有 **`allowScriptExecution`**（Profile → Session）用于 gate 各类「在页面世界执行脚本」的 HTTP 能力；注入 MUST 复用同一语义与错误码（如 `SCRIPT_NOT_ALLOWED` / 403）。
- 子进程为 **外部 Electron**，仅能通过 **CDP** 向 target 注入脚本，而非改 preload。

## Goals / Non-Goals

**Goals:**

- 提供 **显式触发** 的注入：客户端调用单次 HTTP 请求后，Core 枚举 CDP **`page`** 类型 target，将 **该 `appId` 下所有脚本 body** 依次注入到 **每个** target 的页面 JS 世界（见下方 Decisions）。
- **不**根据 **`@match` / URL** 过滤 target 或脚本条目。
- 失败行为可观测：会话未运行、CDP 不可达、`allowScriptExecution === false`、无 target 等均有文档化响应。

**Non-Goals:**

- Tampermonkey 兼容、`GM_*`、非 `none` 的 `@grant`（仍按既有校验拒绝保存）。
- `@match` glob 匹配、SPA 路由监听、自动在新导航上重注入（可作为后续变更）。
- 向 **service worker**、**non-page** target 类型注入（除非后续扩展显式列出）。

## Decisions

### 1. 触发模型：显式 API 首版

- **选择**：**POST** 风格、经 Bearer 鉴权的 **`/v1/sessions/:sessionId/user-scripts/inject`**（最终路径以实现为准，须与 `createApp` 中其它 session 子路由一致）。
- **理由**：行为可测、不绑架「会话一启动就全局执行」的安全心智；便于 Studio/CLI 显式点击。
- **备选**：订阅 `Target.targetCreated` 自动再注入 — 延后，避免首版竞态与重复注入策略未定义。

### 2. Target 范围：`page` 类型、枚举时刻快照

- **选择**：调用 CDP **`Target.getTargets`**（或项目已有等价封装），筛选 **`type === "page"`** 的 target；对**每一个**执行注入管线。
- **理由**：与「读法 A：该 app 下全部适用 target」对齐；`page` 通常含主窗口与 **iframe**（独立 target 时），避免遗漏多框架场景。
- **备选**：仅主 target / 仅顶层 — 覆盖不足，弃用。

### 3. 注入机制：`Runtime.evaluate` 包裹 body（MVP）

- **选择**：对每个 `(targetId, scriptBody)` 在 **isolated world 或默认 world** 中执行一次 `Runtime.evaluate`，将 **解析得到的 body** 作为 **IIFE 或裸脚本**注入（须避免污染命名冲突，见 Risks）。
- **理由**：实现路径短，与现有 `evaluateOnTarget` 一致；不依赖 `Page.addScriptToEvaluateOnNewDocument` 的长期订阅。
- **备选**：`Page.addScriptToEvaluateOnNewDocument` — 更适合「新文档自动跑」，但首版为单次触发，evaluate 足够；若后续加「导航后自动」，再评估。

### 4. 多脚本顺序

- **选择**：按 **稳定顺序**（例如 `script.id` 字典序或 `updatedAt` 升序，实现选一种并文档化）；对同一 target **顺序执行**全部脚本 body。
- **理由**：可重复、可测。

### 5. `@match` 与注入

- **选择**：注入管线 **不得读取** `metadata.matches` 做分支。
- **理由**：用户已确认读法 A。

### 6. 响应体

- **选择**：返回 JSON，含 **`injectedScripts`** 数量、**`targets`** 数量、可选 **`errors[]`**（某 target 失败不静默吞掉，策略：部分失败仍 200 带 errors vs 全部失败 5xx — 实现选一种并在 spec 中固定一种）。

## Risks / Trade-offs

- **[Risk] 同一逻辑在多个 iframe target 重复执行** → 与「全 page target」策略一致；文档说明。
- **[Risk] body 与页面 CSP** → 若页面禁止 `eval`，`Runtime.evaluate` 可能失败；响应中报告 per-target 错误。
- **[Risk] 与「仅存储」用户心智** → README/Studio 标明「注入需显式触发」。
- **[Trade-off] 无自动重注入** → 导航后需再次调用 API。

## Migration Plan

- 仅 additive：新路由 + 逻辑；无数据迁移。
- 归档本变更后：将 delta **合并**入 `openspec/specs/app-user-scripts/spec.md`（reconcile）。

## Open Questions

- 响应模型：**部分 target 失败** 时 HTTP 状态码与 `errors[]` 形状（实现前在 tasks 中定死一种）。
- Studio 是否在首版任务中一并交付（proposal 标为可选）。
