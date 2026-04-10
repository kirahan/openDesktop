## Requirements

### Requirement: 按应用持久化用户脚本与全文

系统 SHALL 支持将用户提交的 **用户脚本源文件**（含 `// ==UserScript==` 元数据块与正文）按 **`appId`** 持久化，并 SHALL 支持对该 app 下脚本的 **创建、读取、更新、删除、列表** 中至少一种对外可测的管理路径（例如经鉴权的 HTTP API）。每条记录 SHALL 保留 **完整源文本**，以便重新解析与审计。

#### Scenario: 创建脚本后可按 app 列出

- **WHEN** 客户端为已存在的 `appId` 提交合法用户脚本源文并成功创建
- **THEN** 后续列表或读取操作 SHALL 能返回该脚本及其 `appId` 归属一致

### Requirement: 解析并存储 UserScript 元数据且保留 @match

系统 SHALL 从源文本中解析 `// ==UserScript==` 与 `// ==/UserScript==`（或项目文档规定的等价边界）之间的 **元数据行**，并 SHALL 至少支持以下键的读取与结构化存储：**`@name`**、**`@namespace`**、**`@version`**、**`@description`**、**`@author`**、**`@match`**（允许多条）、**`@grant`**。

对 **`@match`**：系统 SHALL 将每条非空 `@match` 值 **原样** 存入 `matches` 数组（或等价字段），**不得**因本里程碑无匹配逻辑而省略该字段。

#### Scenario: 多条 @match 均入库

- **WHEN** 源文本包含多条指向不同 host 的 `@match` 行（如用户示例中多条 `https://*.kso.net/*`）
- **THEN** 持久化或 API 返回的结构化元数据 SHALL 包含 **全部** 这些字符串，顺序与源文一致或可文档化稳定顺序

#### Scenario: 缺少必填元数据时拒绝

- **WHEN** 源文本缺少实现所定义的必填键（至少 `@name`，具体以 `design.md` / API 文档为准）
- **THEN** 创建或更新 SHALL 失败并返回可机读错误，且 SHALL NOT 写入半条记录

### Requirement: @grant 受限且与无 GM 能力一致

当存在 **`@grant`** 时，本阶段系统 SHALL 仅接受值为 **`none`**（大小写规则由实现文档化）；若出现任何其他非空 grant 值，系统 SHALL 拒绝保存并返回错误。系统 SHALL NOT 在本变更中实现任何 `GM_*` 或油猴特权 API。

#### Scenario: grant 非 none 时拒绝

- **WHEN** 用户提交 `@grant GM_xmlhttpRequest` 或任意非 `none` 的 grant
- **THEN** 请求 SHALL 失败且 SHALL NOT 持久化该脚本

### Requirement: 本阶段不依据 @match 执行匹配或注入

系统 SHALL **不**根据已存储的 `@match` 对任何请求 URL、会话、target 或导航事件做过滤、路由或自动脚本注入。本阶段 **无**「命中 match 则执行脚本」的行为；脚本的执行（若存在）仅可通过 **显式、独立于 match 的 API**（若未来提供），且 **不在本变更范围内**。

#### Scenario: 仅存储不匹配

- **WHEN** 已存储某脚本的 `matches` 与当前页面 URL 在字面上相符或不相符
- **THEN** 系统行为 SHALL 与「无 match 字段」时一致，即 **不**因 URL 触发任何自动执行或启停

### Requirement: 设计文档声明 SPA 与基于 URL 的 @match 的张力

本变更的 `design.md` SHALL 包含面向维护者的说明：在后续若实现「按 `@match` 自动注入」时，**单页应用（SPA）** 可能在 **无完整文档导航** 的情况下变更 **history / hash**，导致 **仅依赖传统「新文档」时刻的 URL** 的匹配策略 **无法**覆盖全部用户可见路由变化；该说明用于避免将「当前已存储 `@match`」误解为「已具备完整 URL 匹配能力」。

#### Scenario: design.md 含 SPA 与 match 的警告性说明

- **WHEN** 打开本变更目录下的 `design.md`
- **THEN** SHALL 存在阐述 SPA 客户端路由与 `@match` 语义之间矛盾的段落（关键词可包含「SPA」「match」「导航」等同义表述）
