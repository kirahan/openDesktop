## Requirements

### Requirement: CDP 渲染进程全局快照

Core SHALL 提供一种机制，在已附加的 CDP 会话内对指定渲染目标执行单次 `Runtime.evaluate`（`returnByValue: true`），收集 `globalThis` 沿原型链合并去重后的**属性名列表**，并对每个名称记录 **`typeof` 结果**；对 `function` 类型 SHOULD 尝试读取并返回其 `name` 字段（若访问抛错则省略）。实现 SHALL NOT 依赖跨进程传递不可序列化的 live 对象；快照 MUST 为 JSON 可序列化结构。Core SHALL 支持可选的 **interest 模式**（正则字符串），用于在快照中额外列出名称匹配该模式的子集；若模式非法，Core SHALL 返回明确错误且 MUST NOT 在目标页执行任意用户脚本。Core SHALL 支持 **最大条数** 上限，超过时 MUST 设置截断标记并限制返回列表长度。

#### Scenario: 成功返回快照

- **WHEN** 客户端请求对有效 `targetId` 执行全局快照且页面脚本执行被允许
- **THEN** 响应体包含属性名列表、每项类型信息、以及可选的 `interestMatches` 与 `truncated` 字段

#### Scenario: 正则无效

- **WHEN** 客户端传入无法编译的 `interestPattern`
- **THEN** Core 返回错误且不在目标页执行探测逻辑之外的代码

#### Scenario: 超过 maxKeys

- **WHEN** 全局属性数量超过配置的 `maxKeys`
- **THEN** 返回的属性列表被截断且 `truncated` 为真

### Requirement: Agent 动词 renderer-globals

Agent API SHALL 将上述能力暴露为 canonical 动词 `renderer-globals`（与 OpenCLI operate 对齐命名风格），请求体 MUST 包含 `targetId`，MAY 包含 `interestPattern` 与 `maxKeys`。该动词 SHALL 与现有 `eval` 在「是否允许脚本执行」的策略上保持一致（同一 Profile / 会话约束）。

#### Scenario: Agent 调用成功

- **WHEN** `POST /v1/agent/sessions/:sessionId/actions` 的 body 包含 `"action": "renderer-globals"` 与有效 `targetId`
- **THEN** 响应包含与 CDP 全局快照一致的结构化 JSON

#### Scenario: 动词出现在版本列表

- **WHEN** 客户端调用 `GET /v1/version`
- **THEN** 返回的 `agentActions` 列表包含 `renderer-globals`

### Requirement: CLI 封装

CLI SHALL 提供子命令，使用已配置的 API 基址与 token，对指定会话发起上述 Agent 动作并输出 JSON（stdout），以便自动化与 OpenCLI 工作流复用。

#### Scenario: CLI 调用

- **WHEN** 用户在 Core 已启动且 token 有效的情况下执行文档化的 `opd` 子命令并传入 sessionId 与必要参数
- **THEN** 进程退出码反映 HTTP 成功与否且 stdout 为快照 JSON
