## REMOVED Requirements

### Requirement: 本阶段不依据 @match 执行匹配或注入

**Reason**：已由「`@match` 不参与注入决策」与「显式按会话注入」替代；本里程碑将提供 **显式**、**不依赖 URL / `@match`** 的注入路径。

**Migration**：验收与测试从「永不注入」改为「仅在不调用注入 API 时不注入；调用注入 API 时按新 Requirement 行为」。持久化与 CRUD 要求不变。

## ADDED Requirements

### Requirement: @match 不参与注入决策

系统 SHALL **不**根据已存储的 `@match` 或当前 document URL 对用户脚本的 **是否注入、注入到哪些 target** 做过滤或路由。**`@match`** SHALL 继续仅作元数据存储与 API 返回（与既有解析与存储行为一致）。

#### Scenario: match 与 URL 不影响注入范围

- **WHEN** 某脚本存有多条 `@match`，且当前任一 target 的页面 URL 与这些字符串字面相符或完全不相符
- **THEN** 注入行为 SHALL **不**因 `@match` 或 URL 而跳过某条脚本或某个 `page` target

#### Scenario: 未调用注入时不执行

- **WHEN** 客户端仅使用脚本的创建/更新/列表 API，**未**调用注入 API
- **THEN** 系统 SHALL NOT 仅因会话运行或页面导航而自动执行用户脚本正文

### Requirement: 显式会话级注入 API

当会话处于 **`running`**、CDP 可连接且会话的 **`allowScriptExecution`** 为允许时，系统 SHALL 提供经 Bearer 鉴权的 HTTP 接口，使客户端能 **显式触发** 一次注入流程：解析该会话 Profile 所属 **`appId`**，读取该 `appId` 下 **全部**已存储用户脚本，将每条脚本的 **正文**（元数据块外 `body`）按实现文档化的稳定顺序，注入到 **注入请求发起时刻** CDP 所枚举到的 **全部 `page` 类型 target**（见 `design.md` 对 CDP 域与 target 筛选的定义）。

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

### Requirement: 设计文档与 README 说明显式注入与 @match 关系

`design.md` 与面向使用者的 README（或等价文档）SHALL 说明：**注入由显式 API 触发**；**`@match` 不参与注入决策**；**多 `page` target 时同一脚本 body 可能在多处执行**。

#### Scenario: 文档可发现性

- **WHEN** 维护者阅读本变更的 `design.md` 或仓库 README 用户脚本小节
- **THEN** SHALL 能找到上述三段含义的阐述（可用不同措辞，但不得相互矛盾）
