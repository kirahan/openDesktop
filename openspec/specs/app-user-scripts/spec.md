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

### Requirement: @match 不参与注入决策

系统 SHALL **不**根据已存储的 `@match` 或当前 document URL 对用户脚本的 **是否注入、注入到哪些 target** 做过滤或路由。**`@match`** SHALL 继续仅作元数据存储与 API 返回（与既有解析与存储行为一致）。

#### Scenario: match 与 URL 不影响注入范围

- **WHEN** 某脚本存有多条 `@match`，且当前任一 target 的页面 URL 与这些字符串字面相符或完全不相符
- **THEN** 注入行为 SHALL **不**因 `@match` 或 URL 而跳过某条脚本或某个 `page` target

#### Scenario: 未调用注入时不执行

- **WHEN** 客户端仅使用脚本的创建/更新/列表 API，**未**调用注入 API
- **THEN** 系统 SHALL NOT 仅因会话运行或页面导航而自动执行用户脚本正文

### Requirement: 显式会话级注入 API

当会话处于 **`running`**、CDP 可连接且会话的 **`allowScriptExecution`** 为允许时，系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端能 **显式触发** 一次注入流程：解析该会话 Profile 所属 **`appId`**，读取该 `appId` 下 **全部**已存储用户脚本，将每条脚本的 **正文**（元数据块外 `body`）按实现文档化的稳定顺序，注入到 **注入请求发起时刻** CDP 所枚举到的 **全部 `page` 类型 target**（见实现 `design.md` 对 CDP 域与 target 筛选的定义）。

系统 SHALL **不**实现 `GM_*` 或油猴特权 API；正文执行环境与既有「无 GM」模型一致。

#### Scenario: allowScriptExecution 为 false

- **WHEN** 会话的 `allowScriptExecution === false`
- **THEN** 注入请求 SHALL 失败并返回 **403** 及项目统一的脚本禁止错误码（如 `SCRIPT_NOT_ALLOWED`），且 SHALL NOT 在任意 target 执行用户脚本正文

#### Scenario: 会话非 running 或 CDP 不可用

- **WHEN** 会话未处于 `running`，或 Core 无法连接该会话 CDP
- **THEN** 注入请求 SHALL 失败并返回可机读错误，且 SHALL NOT 声称注入成功

#### Scenario: app 下无脚本

- **WHEN** 该 `appId` 下无任何用户脚本记录
- **THEN** 注入请求 SHALL 返回成功语义（HTTP **2xx**），且响应 SHALL 标明注入脚本条数为 **0**，且 SHALL NOT 报错为「资源不存在」类 404（除非会话本身不存在）

#### Scenario: 至少一个 page target 且有一条脚本

- **WHEN** CDP 至少返回一个 `page` 类型 target，且该 `appId` 下至少有一条合法脚本
- **THEN** 系统 SHALL 对每个 `page` target 尝试执行注入管线至少一次，且成功路径下 SHALL 在该 target 的页面 JS 环境执行该脚本的 `body`

### Requirement: 设计文档声明 SPA 与基于 URL 的 @match 的张力

面向维护者的设计文档 SHALL 包含说明：在后续若实现「按 `@match` 自动注入」时，**单页应用（SPA）** 可能在 **无完整文档导航** 的情况下变更 **history / hash**，导致 **仅依赖传统「新文档」时刻的 URL** 的匹配策略 **无法**覆盖全部用户可见路由变化；该说明用于避免将「当前已存储 `@match`」误解为「已具备完整 URL 匹配能力」。

#### Scenario: design 含 SPA 与 match 的警告性说明

- **WHEN** 维护者阅读与本能力相关的设计文档
- **THEN** SHALL 存在阐述 SPA 客户端路由与 `@match` 语义之间矛盾的段落（关键词可包含「SPA」「match」「导航」等同义表述）

### Requirement: 设计文档与 README 说明显式注入与 @match 关系

`design.md` 与面向使用者的 README（或等价文档）SHALL 说明：**注入由显式 API 触发**；**`@match` 不参与注入决策**；**多 `page` target 时同一脚本 body 可能在多处执行**。

#### Scenario: 文档可发现性

- **WHEN** 维护者阅读相关 `design.md` 或仓库 README 用户脚本小节
- **THEN** SHALL 能找到上述三段含义的阐述（可用不同措辞，但不得相互矛盾）
