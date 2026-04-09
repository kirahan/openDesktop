## Requirements

### Requirement: 实时控制台流端点

在会话处于 `running` 且 CDP 可用时，系统 SHALL 提供经鉴权的 HTTP 接口，使客户端能够按 `sessionId` 与 `targetId` **订阅**该调试目标在订阅建立**之后**新产生的控制台 API 调用事件（与 CDP `Runtime.consoleAPICalled` 语义一致）。系统 SHALL NOT 声称提供 DevTools 历史缓冲区中的**过往**控制台消息。

#### Scenario: 订阅成功后收到新日志

- **WHEN** 目标页面在订阅已建立后执行 `console.log('hello')`
- **THEN** 客户端在合理延迟内收到至少一条事件，其内容与 `hello` 一致或可读的参数预览（与现有 `console-messages` 预览策略对齐）

#### Scenario: 会话非 running 或 CDP 不可用

- **WHEN** 客户端请求订阅但会话不是 `running` 或 CDP 未就绪
- **THEN** 服务器返回文档化的错误状态（如 503）且正文可机读，且不建立无限挂起且无事件的长连接

### Requirement: 订阅生命周期与资源上限

系统 SHALL 支持显式结束订阅（客户端断开或服务器关闭连接）。系统 SHALL 对单会话或全局的并发控制台流数量施加上限；超出上限时 SHALL 返回可解析错误且 SHALL NOT 静默失败为空白流。

#### Scenario: 客户端断开连接

- **WHEN** 客户端关闭传输连接
- **THEN** 服务器释放对应的 CDP 监听资源（在进程内不再保留该订阅的专用连接）

### Requirement: 与脚本执行权限无关

开启实时控制台流 SHALL NOT 要求对应 Profile 设置 `allowScriptExecution: true`（与短时 `console-messages` 采样行为一致，除非实现证明 CDP 层强制依赖该标志——则本 requirement 需在实现前修订）。

#### Scenario: 仅只读 Profile

- **WHEN** 会话关联的 Profile 未开启 `allowScriptExecution`
- **THEN** 客户端仍可成功建立控制台事件流（在其余条件满足时）

### Requirement: Studio 展示

Studio SHALL 提供「实时控制台」视图：在成功建立订阅后，将收到的事件**追加**展示，并提供「清屏」或等价操作以清空视图；SHALL 支持多调试目标以多标签等方式切换；界面 MAY 以右侧抽屉等形式呈现且默认收起，具体交互以产品界面为准。SHALL 对过长列表采用可接受的性能策略（例如虚拟列表或条数上限提示）。

#### Scenario: 清屏

- **WHEN** 用户触发清屏
- **THEN** 视图内已展示条目被清除，且不影响后续新到达事件的显示
