## ADDED Requirements

### Requirement: 注册阶段约定的 appId 与 App-first 一致

文档 SHALL 说明：通过应用注册流程（CLI 快乐路径或 Web）显式指定的 **应用 id（调用名）** 即后续 `yarn oc <appId> <子命令>` 中的 `<appId>`；用户 MUST NOT 被要求记忆与注册 id 不同的第二套名称以使用 App-first（除非未来引入显式别名能力并单独成 spec）。

#### Scenario: README 交叉引用

- **WHEN** 用户阅读根目录 README 中「注册应用」与「App-first」相关小节
- **THEN** 可见二者使用同一 `appId` 命名空间的说明，或指向 `app-register-bootstrap` 能力说明
