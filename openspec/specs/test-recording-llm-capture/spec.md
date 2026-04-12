# test-recording-llm-capture Specification

## Purpose
TBD - created by archiving change test-recording-llm-capture. Update Purpose after archive.
## Requirements
### Requirement: 制品为版本化 JSON，且仅描述「记录数据」

系统 MUST 将 **LLM 用测试录制制品**定义为 **单一 JSON 文档**，且 MUST 包含整数 **`schemaVersion`**（从 **1** 起）与字符串 **`kind`**（固定值由 `design.md` 写明，用于与无关 JSON 区分）。本能力 **MUST NOT** 要求 Core 或 Web 在录制路径上调用大语言模型或生成可执行测试脚本；**MUST NOT** 将「生成 Recipe / Playwright / Agent 步骤」作为本 spec 的验收条件。

#### Scenario: 合法制品可被校验通过

- **WHEN** 某 JSON 对象含支持的 `schemaVersion` 与 `kind`，且含 **`appId`**、`sessionId`、`targetId` 与有序 `steps` 数组
- **THEN** 校验器 SHALL 接受该制品为 **test-recording-llm-capture** 合法实例（允许额外扩展字段，若实现声明 `additionalProperties` 策略）

#### Scenario: 缺关键字段被拒绝

- **WHEN** `schemaVersion` 缺失或未知、`kind` 不匹配、`appId` 缺失或为空、或 `steps` 非数组
- **THEN** 校验 SHALL 失败并返回可机读原因

---

### Requirement: 按应用分区的落盘目录

实现 MUST 在 **`dataDir`**（或配置解析后的等价根）下使用 **专用根目录** 存放本能力及后续同类 **应用侧 JSON 记录**；默认路径语义 MUST 与 **`design.md`** 一致（默认 **`<dataDir>/app-json/`**）。每个 **应用** MUST 对应 **唯一子目录**，目录名 MUST 与制品中的 **`appId`** 一致且 MUST 经安全处理（防止路径穿越）。

写入测试录制制品时，实现 MUST 将文件置于 **`<根>/<appId>/`** 下，MUST 使用 **原子写**（临时文件再 rename），且 MUST 在首次写入前创建缺失目录。

实现 SHOULD 支持通过 **`OPENDESKTOP_APP_JSON_DIR`** 将整个 **根目录** 重定向到用户指定路径（行为以 `design.md` 为准）。

#### Scenario: 落盘路径可预测

- **WHEN** `dataDir` 为 `/var/od-data`、`appId` 为 `my-app`、文件名为 `test-recording-abc.json`
- **THEN** 最终路径 SHALL 为 `/var/od-data/app-json/my-app/test-recording-abc.json`（在未设置 `OPENDESKTOP_APP_JSON_DIR` 的前提下）

---

### Requirement: 会话与页面上下文字段

制品 MUST 包含 **`sessionId`** 与 **`targetId`**（与 OpenDesktop 会话及 CDP page target 一致）。制品 SHOULD 包含 **`recordedAt`**（ISO 8601 字符串）与 **`pageContext`** 对象；**`pageContext`** SHOULD 至少能承载 **`viewportWidth`**、**`viewportHeight`**（正数），MAY 包含 **`pageUrl`**、**`documentTitle`** 若在实现时可无歧义取得。

#### Scenario: 视口尺寸与矢量坐标系一致

- **WHEN** 制品来自与矢量录制同一会话
- **THEN** `pageContext` 中的视口宽高 SHOULD 与矢量事件中 `viewportWidth`/`viewportHeight` 同源或同一时刻，以便 LLM 将坐标与布局对齐

---

### Requirement: 有序步骤与机器采集字段

每个 **`steps[]` 元素** MUST 包含：

- **`ts`**：毫秒时间戳（与录制事件可对照）；
- **`action`**：字符串枚举，首期 MUST 支持 **`click`**，MAY 预留其它值并在 `design.md` 列出。

对于 **`action` 为 `click`** 的步骤，制品 MUST 在机器采集部分包含或可推导 **视口坐标** **`x`** 与 **`y`**（CSS 像素）。制品 SHOULD 包含与现有矢量 **`click.target`** 同义的 **`vectorTarget`** 对象（当原始事件提供时 MUST 不丢弃已采集的 `tagName`、`selector` 等摘要字段）。

制品 MAY 包含 **`domPick`** 对象：仅当本步关联了 **DOM 拾取 resolve** 结果时；若存在，MUST 与 `design.md` 中引用的 **HTTP 响应子集** 字段名一致或提供显式映射表。

制品 MAY 包含 **`structureAnchor`**：用于指向该步附近的页面文本或结构摘要（截断策略 MUST 在 `design.md` 中量化）。

#### Scenario: 点击步包含坐标与目标摘要

- **WHEN** 矢量流中某次 `click` 被归并为一步且带 `target`
- **THEN** 该步制品 MUST 含 `x`、`y`，且 SHOULD 含 `vectorTarget`，其语义与 `packages/core` 矢量 schema 一致

#### Scenario: 无点击的步骤

- **WHEN** 某步仅为占位或仅含人工说明（若实现允许）
- **THEN** `design.md` MUST 定义允许的 `action` 与必填字段，避免校验器无法处理

---

### Requirement: 人工补充字段（仅作 LLM 上下文）

制品 MAY 在顶层包含 **`notes`**（字符串）。每个 step MAY 包含 **`human`** 对象；若存在，**MUST** 为对象且 **SHOULD** 支持：

- **`actionDescription`**：用户描述所执行操作的自然语言；
- **`expectedDescription`**：用户描述期望现象的自然语言。

系统 MUST NOT 使用上述字段作为执行断言或自动通过依据；其存在 **SOLELY** 为下游 LLM 与人工审阅提供语义。

#### Scenario: 仅填整段 notes 亦为合法

- **WHEN** `steps[].human` 全部省略但 `notes` 非空
- **THEN** 制品 MUST 仍可通过校验（若其它必填字段满足）

---

### Requirement: 导出与下游消费

实现 MUST 提供 **落盘后的 JSON 文件** 作为权威来源之一（与 `design.md` 路径约定一致）。实现 SHOULD 另提供 **只读 API 或下载**，使授权用户能获取与磁盘一致的完整制品内容；MAY 支持剪贴板作为辅助。导出载荷 MUST 与上述 schema 一致；MAY 增加 **`exportMeta`**（导出时间、来源版本号）而不改变核心语义。

系统 MUST 在文档中声明：制品可能含 **敏感页面文本与 URL**，默认假设为 **本地调试与受控 Bearer 访问**，不得暗示默认上传至第三方。

#### Scenario: 落盘与内存组装一致

- **WHEN** 同一录制会话先内存组装再写入磁盘，再读回文件
- **THEN** 核心字段集合 MUST 一致（允许 `exportMeta` 仅存在于某类导出响应）

---

### Requirement: 与既有能力的关系

本 spec **MUST NOT** 修改 **`page-session-replay`**、**`cdp-dom-pick`**、**`cdp-operation-recipes`** 中已归档条文的语义。实现 MAY **引用**矢量事件流与 dom-pick API 作为输入；若引用，MUST 在 `design.md` 中写明字段映射与归并规则。

#### Scenario: 无矢量录制时

- **WHEN** 某部署尚未开启矢量录制
- **THEN** 本能力 MAY 降级为「仅文档与 schema」，或返回明确 **503** / 空制品；行为 MUST 在 `design.md` 中说明

