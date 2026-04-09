## Requirements

### Requirement: 未捕获异常的调用栈采集

系统 SHALL 在具备有效会话与 `targetId`、且满足实现文档化的权限前提（与现有脚本类动作对齐时，为 `allowScriptExecution: true`）时，通过 CDP `Runtime` 域订阅 **`Runtime.exceptionThrown`** 事件，并在文档约定的时间或事件模型内，将 **结构化调用栈** 返回给调用方。结构化栈 SHALL 由若干 **帧** 组成；每帧至少包含实现可从 CDP 映射的字段（如函数名、脚本 URL、行号、列号中的可用子集），若某字段不可用则 MAY 省略或使用空值，但 SHALL NOT 伪造数据。

#### Scenario: 窗口内捕获到异常

- **WHEN** 在观测窗口内目标页抛出未捕获异常且 CDP 投递 `exceptionThrown`
- **THEN** 响应 JSON SHALL 包含 `frames` 数组或文档约定的等价结构，且长度不超过实现设定的最大帧数

#### Scenario: 权限不足

- **WHEN** 会话存在但脚本执行未获准（若本能力要求与 `eval` 一致）
- **THEN** 响应 SHALL 为 403 或可映射错误码，且 SHALL NOT 返回伪造栈

### Requirement: 无异常或监听失败

当观测窗口结束时尚未收到异常，或 CDP 订阅失败，系统 SHALL 返回明确语义：例如 `frames` 为空数组并带 `note` 字段，或返回可区分错误码；SHALL NOT 以 HTTP 200 冒充「曾捕获栈」若实际未捕获。

#### Scenario: 安静页面

- **WHEN** 窗口内无未捕获异常
- **THEN** 响应 SHALL 表明无栈或空栈，且不与错误状态混淆（除非实现将「超时无事件」定义为单独错误码并在文档说明）

### Requirement: 规模与脱敏

系统 SHALL 对单响应中栈帧条数、单帧字符串长度设上限；对 URL 类字段 MAY 做与项目其它观测能力一致的 strip/hash。系统 SHALL NOT 默认返回无上限的原始异常消息全文若超过长度 cap。

#### Scenario: 超长消息截断

- **WHEN** 异常 `text` 超过实现设定的最大长度
- **THEN** 响应 SHALL 截断或省略并标明截断

### Requirement: 可发现性

当 Agent API 启用且本能力已实现时，`GET /v1/version` 的 `agentActions` SHALL 包含 canonical 动词 `runtime-exception`。

#### Scenario: 版本列表包含新动词

- **WHEN** 客户端请求 `GET /v1/version`
- **THEN** `agentActions` 包含 `runtime-exception`
