# studio-global-shortcuts Specification (delta)

本文件为 **变更增量**，归档时将合并入 `openspec/specs/studio-global-shortcuts/spec.md`。

## ADDED Requirements

### Requirement: 多 target 并行时打点类快捷键的目标选择策略

当同一会话下存在 **多于一个** `targetId` 处于矢量录制**活跃**状态，或 Studio 存在多个与不同 `targetId` 绑定的观测上下文时，用户通过 **全局快捷键** 触发 **打入点**、**出点**、**检查点** 类动作时，系统 SHALL 采用 **文档化且唯一默认** 的目标选择策略（见 `session-replay-multi-target-parallel/design.md` **D5**）。系统 SHALL NOT 在未定义策略时随机选择 target。

系统 SHALL 在 UI 或文档中说明当前策略（例如：**以当前选中的观测 tab 所对应的 `targetId` 为准**）。若当前上下文不满足打点前置条件，系统 SHALL 与对应按钮行为一致（无操作、提示或错误）。

#### Scenario: 策略可查询

- **WHEN** 用户查看全局快捷键或打点相关帮助
- **THEN** 用户 SHALL 能获知「多 target 并行时打点作用于哪一个 target」的规则

#### Scenario: 无有效目标时不打点

- **WHEN** 当前选中 tab 非矢量录制流、或未绑定有效 `targetId`、或录制未运行（与按钮前置一致）
- **THEN** 快捷键触发 SHALL NOT 对任意 `targetId` 写入入点/出点/检查点

#### Scenario: 单 target 时与既有行为一致

- **WHEN** 同会话仅存在一个满足条件的矢量录制 target
- **THEN** 快捷键打点 SHALL 作用于该 `targetId`，与变更前用户预期一致
