## Purpose

在 Core 已注册应用的前提下，CLI 支持以 `yarn oc <appId> <子命令>` 形式针对指定应用执行观测或 Agent 等能力，而无需手写 `sessionId`（可通过 `--session` 覆盖会话解析）。

## Requirements

### Requirement: App-first 调用形式

Core CLI SHALL 支持一种 **App-first** 调用形式：在解析全局选项之后，若剩余位置参数至少为两项，且第一项**不是**保留的顶层子命令名，第二项为已注册的 **App-first 子命令**，则 SHALL 将该行解释为「针对应用 `appId` 执行该子命令」，而不要求用户在命令行中手写 `sessionId`（可通过 `--session` 可选覆盖会话解析规则）。

#### Scenario: 基本形态

- **WHEN** 用户执行与文档等价的命令，形式为 `yarn oc <appId> <sub命令>`（或通过同一 `cli` 入口传入相同 argv），且 `<appId>` 不是保留顶层名、`<子命令>` 为已注册子命令之一
- **THEN** CLI 进入 App-first 流程并成功解析出 `appId` 与子命令，不因缺少位置参数形式的 `session` 子命令而失败

#### Scenario: 保留顶层名不作为 appId

- **WHEN** 第一个位置参数为保留顶层名（例如 `session`、`app`、`core` 等，以实现文档为准）
- **THEN** CLI SHALL NOT 将该输入解释为 App-first 的 `appId`（应交由常规 Commander 流程处理）

### Requirement: 注册阶段约定的 appId 与 App-first 一致

文档 SHALL 说明：通过应用注册流程（CLI 快乐路径或 Web）显式指定的 **应用 id（调用名）** 即后续 `yarn oc <appId> <子命令>` 中的 `<appId>`；用户 MUST NOT 被要求记忆与注册 id 不同的第二套名称以使用 App-first（除非未来引入显式别名能力并单独成 spec）。

#### Scenario: README 交叉引用

- **WHEN** 用户阅读根目录 README 中「注册应用」与「App-first」相关小节
- **THEN** 可见二者使用同一 `appId` 命名空间的说明，或指向 `app-register-bootstrap` 能力说明

### Requirement: 已注册的 App-first 子命令集合

系统 SHALL 在 App-first 模式下识别下列子命令（实现 MAY 另支持**文档化**的别名）：`snapshot`、`list-window`、`metrics`、`list-global`、**`explore`**；SHALL 支持 `topology` 作为 `list-window` 的兼容别名（行为与 `list-window` 一致）。

#### Scenario: list-window 与 metrics

- **WHEN** 子命令为 `list-window` 或 `metrics`
- **THEN** CLI 行为与当前实现对观测 API 的调用一致（输出格式受 `--format` 约束）

#### Scenario: topology 别名

- **WHEN** 子命令为 `topology`
- **THEN** 与 `list-window` 等价（同一解析分支或文档化映射）

#### Scenario: explore

- **WHEN** 子命令为 `explore`
- **THEN** CLI SHALL 调用与 `POST /v1/agent/sessions/:sessionId/actions` 中 `action: explore` 等价的 HTTP 请求；`--target` 与可选 `--max-candidates`、`--min-score`、`--include-anchor-buttons` 行为以 README 与实现为准

### Requirement: 可发现性与扩展

项目文档（至少根目录 `README.md`）SHALL 描述 App-first 形式及上述子命令；新增 App-first 子命令时 SHALL 同步更新该文档与类型/常量注册处，并保持单元测试覆盖解析与分发路径。

#### Scenario: 文档存在 App-first 说明

- **WHEN** 维护者查阅根目录 README 中 App-first 小节
- **THEN** 可见 `yarn oc <appId> <子命令>` 的说明及至少 `list-window`、`metrics`、`snapshot`、`list-global`、`explore` 的提及方式与实现一致
