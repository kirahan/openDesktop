# ux-app-session-terminology Specification

## Purpose

约定 **用户可见文案、Web 主路径** 与 **Core 内部模型（App、Profile、Session）** 的对应关系：降低「Profile 与 Session 是否同一含义」的心智负担，同时不否认 API 与存储中的 Profile 能力。

内部模型仍为：**App**（可执行与路径级定义）→ **Profile**（绑定到某应用的启动配置：env、extraArgs 等）→ **Session**（按某 Profile 实际拉起的一次运行实例）。本 spec 只约束 **对外怎么说**，不约束 HTTP 路径与字段名。

## Requirements

### Requirement: 主路径对外优先使用「应用」与「会话」

面向初次用户与主流程说明（含根 README 主节、Web 注册与列表区主文案），SHALL 以 **「应用」** 与 **会话**（或「调试会话」「运行中会话」）组织叙述；SHALL NOT 要求用户在未进入高级场景前，将 **Profile** 当作与「应用」并列的必记概念。

#### Scenario: 默认单配置不强调 Profile 名词

- **WHEN** 产品采用「每应用一个默认配置」的约定（例如默认 Profile id 为 `appId-default`，且由 `yarn oc app create` 或 Web 注册流程自动创建）
- **THEN** 主界面与主文档 MAY 不显式展示 Profile 选择器，或仅用「默认启动方式」「该应用的配置」等从属表述，避免首屏出现孤立术语「Profile」

### Requirement: 弱化 Profile 不等于删除内部能力

HTTP API（如 `GET/POST /v1/profiles`）、CLI 子命令（如 `profile list`）、持久化结构 SHALL 继续支持 Profile；本要求仅约束 **默认体验下的措辞与信息架构**，不删除或合并内部资源类型。

#### Scenario: 排错与进阶仍可对齐真实模型

- **WHEN** 用户查阅 API 文档、调试多配置、或使用需 `profileId` 的 CLI 命令
- **THEN** 文档 MAY 明确使用「Profile」或「启动配置」，并说明其与 `appId`、会话创建请求体的关系

### Requirement: 高级场景暴露「配置」而非强行合并概念

当同一 **应用** 存在 **多套启动配置**（多 Profile）时，UI 与文档 SHALL 使用 **「配置」「启动配置」** 等用户语言引入差异，并说明 **会话** 是在选定配置下的一次运行；SHALL NOT 为简化而声称 Profile 与 Session 为同一实体。

#### Scenario: 多 Profile 时的列表或选择

- **WHEN** 用户需要为同一应用选择不同环境或参数组合
- **THEN** 界面或文案 SHALL 能区分「选哪套配置」与「当前有没有在跑的会话」，且术语不与内部 `POST /v1/sessions` 语义冲突

### Requirement: 默认配置命名与主路径一致

若产品提供自动创建的默认 Profile，其 id 命名规则（例如 `appId-default`）SHALL 在 `app-register-bootstrap` 或等价能力中保持一致；主路径文案 MAY 不提该 id，仅在进阶或 CLI 示例中写出。

#### Scenario: 与 app create 约定对齐

- **WHEN** 维护者实现或文档化「注册后可直接启动会话」的快乐路径
- **THEN** 默认 Profile 的创建与命名与已有 OpenSpec 能力描述一致，且本 spec 的主路径「应用 + 会话」叙述不与该实现矛盾