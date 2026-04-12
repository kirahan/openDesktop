## Why

团队已具备 DOM 拾取、矢量会话录制与结构快照等能力，但**尚缺一种面向「后续由 LLM 生成自动化用例」的、统一且足够信息密度的录制产物**。若仅把原始 SSE 行或零散事件交给模型，容易出现定位歧义、缺少页面语境与人工意图，导致生成用例质量不稳。

本变更定义**只负责记录与导出数据**：不实现 LLM 调用、不生成 Recipe 或 Playwright 脚本；录制侧目标是**在隐私与体积可控前提下，沉淀可被下游一次性消费的 JSON 制品**，供外部或 Studio 内联的 LLM 管线使用。

## What Changes

- 新增能力 **`test-recording-llm-capture`**：定义 **LLM 用测试录制制品**（artifact）的 schema、必填与可选字段、与现有矢量事件及可选 CDP 拾取数据的**对齐方式**。
- 约定制品中**会话级元数据**（时间、`appId`、target、视口、页面 URL 或标题若可得）、**有序步骤列表**（每步合并指针与点击、点击目标摘要、可选拾取结果、可选快照锚点）、以及**人工补充层**（每步或整段录制的自然语言：操作说明、期望现象；**不参与校验逻辑**，仅作 LLM 上下文）。
- **落盘布局**：在 OpenDesktop **数据目录**下设立**专用根目录**，用于存放「应用运行与录制过程中产生的各类 JSON 记录」；**每个应用独占一个子目录**（以 `appId` 区分），具体路径、文件命名与环境变量覆盖在 `design.md` 中定稿。制品 MUST 能写入该布局（原子写、可发现）；另 MAY 提供下载或只读 API。

## Capabilities

### New Capabilities

- `test-recording-llm-capture`：仅描述**数据记录与制品结构**；明确 **Out of Scope：用例生成、断言执行、Recipe 写入**。

### Modified Capabilities

- （无）不修改既有 `page-session-replay`、`cdp-dom-pick`、`cdp-operation-recipes` 的 normative 段落；仅在 design 中说明**如何引用**已有事件与端点。

## Impact

- **packages/core**：新增或扩展 **config**（根路径默认值、可选 `OPENDESKTOP_*` 覆盖）、**目录创建**、制品**序列化与原子落盘**；可选导出 HTTP 与列表接口。
- **数据目录**：在既有 `dataDir` 下新增一层专用树（见 design），与 `recipes/`、`apps.json` 等并存；**备份与清理策略**在文档中说明。
- **packages/web**：可选「结束录制并保存」「按应用浏览已落盘 JSON」等 UI。
- **下游**：LLM 或脚本直接读取磁盘文件或通过 API；版本字段便于演进。
