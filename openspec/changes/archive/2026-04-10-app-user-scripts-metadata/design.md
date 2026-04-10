## Context

OpenDesktop 已具备按 **app / profile / session** 管理 Electron 应用与 CDP 调试能力；用户有动机为 **特定应用** 编写类似油猴的脚本，并使用 `// ==UserScript==` 元数据表达意图。脚本 **相对 app 归属** 可缩小信任域，但 **URL 级** 的 `@match` 与 **SPA 内无整页导航** 的行为冲突，需在实现「自动注入」前单独建模。

## Goals / Non-Goals

**Goals:**

- 为每个 **已注册的 `appId`** 提供用户脚本的 **持久化**（原文 + 解析后的结构化字段）。
- 解析并 **可靠存储** UserScript 头中的 **`@match` 列表**（及其他约定字段），供后续消费；**即使当前无消费者**，字段也不得丢弃。
- 在设计与 spec 中 **明确记录**：本里程碑 **不**根据 `@match` 做任何运行时决策；并记录 **SPA 客户端路由** 导致「仅依赖导航时 URL 的 match」**不完整** 的风险，避免实现阶段误用。

**Non-Goals:**

- 实现 `@match` 与当前 document URL 的匹配算法。
- 实现 `Page.addScriptToEvaluateOnNewDocument` / 定时注入 / SPA 后的 URL 监听与重评。
- 实现 `GM_*` 或除 `@grant none` 外的特权模型。
- 完整兼容 Tampermonkey 全部元数据键与匹配语义（可实现 **声明式子集**，见 Decisions）。

## Decisions

### 1. 元数据子集与 `@match` 存储形态

- **选择**：解析器输出结构化对象，其中 **`matches: string[]`** 对应头中 **所有 `@match` 行**（去重顺序按出现顺序）；**不**在存储层做 URL 规范化或模式编译。
- **理由**：本阶段无运行时匹配，保留 **原文级** 列表即可满足「保留字段」；后续实现匹配时再定是否编译为内部表示。
- **备选**：仅存原始 header 文本——查询与展示不友好，弃用。

### 2. `@grant`

- **选择**：本阶段仅允许 **`none`**（或省略 `@grant` 并视为 `none`）；若出现其他值，**创建/更新脚本失败** 并返回可机读错误码，避免「假支持」。
- **理由**：与「不做 GM 兼容」一致。

### 3. 存储归属

- **选择**：脚本资源 **按 `appId` 键控**（每个 app 下列表/增删改）；不与 session 强绑定，避免会话结束即丢脚本。
- **理由**：与用户「相对 app」心智一致；会话级注入为后续能力。

### 4. API 形态（建议）

- **选择**：由 Core 提供 **REST JSON** 管理接口（例如 `GET/POST/PATCH/DELETE /v1/apps/:appId/user-scripts` 或等价路径，最终以实现为准），请求/响应体包含 `source`（完整 `.user.js` 文本）及/或服务端解析后的 `metadata`。
- **理由**：与现有 Core HTTP 风格一致；Studio 后续可接。

### 5. SPA 与 `@match` 的已知矛盾（仅设计记录，本阶段不解决）

- **问题**：许多 Electron 内嵌页为 **SPA**，`history.pushState` / hash 变化 **不**触发「新文档」；若将来仅用「导航瞬间的 URL」做 match，会与用户看到的 **地址栏/路由** 变化 **不同步**，除非额外订阅 `Page.navigate` 之外的事件。
- **本阶段处理**：**不实现匹配**，故无错误行为；在 spec 中用 **NON-NORMATIVE** 或单独 **Requirement: 已知限制** 说明，强制后续变更显式处理 SPA 再启用自动注入。

## Risks / Trade-offs

- **[Risk] 用户误以为 `@match` 已生效** → 文档、API 错误消息与 Studio 文案中强调「已存储但未用于过滤」；可选字段 `metadata.matches` 旁注「reserved」。
- **[Risk] 解析器与油猴行为不一致** → 在 spec 中 **明确支持的键列表**；不支持键可忽略或报错策略二选一并写死。
- **[Trade-off] 仅存结构化数据 vs 存全文** → 建议 **全文 + 解析缓存**（或每次请求重解析），便于展示与校验。

## Migration Plan

- 新增数据文件或集合，**无**旧数据迁移；首版部署即可用。

## Open Questions

- 是否在列表 API 中返回 **解析耗时** 或 **校验警告**（非致命）——可延后。
- 单 app 下脚本数量上限与单文件大小上限（防 DoS）——实现阶段用常量约束。
