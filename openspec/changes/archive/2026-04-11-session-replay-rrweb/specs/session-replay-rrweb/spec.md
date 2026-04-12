## ADDED Requirements

### Requirement: 通用 rrweb 注入包构建物

系统 SHALL 在构建管线中产出可注入的 **`inject.bundle.js`**（单文件、可经由 CDP `Runtime.evaluate` 执行），其内 SHALL 包含 **`@rrweb/record` 兼容版本**的录制启动逻辑（具体包名以实现为准，须与 Replayer 主版本兼容）。构建产物路径或拷贝策略 SHALL 使 **Core 注入 API** 与 **文档** 能引用同一版本，避免「Web 与注入包版本不一致」。

#### Scenario: 构建产物可被 Core 读取

- **WHEN** 部署或本地构建完成且 `inject.bundle.js` 已生成到设计约定目录
- **THEN** Core 在响应「注入 rrweb 包」类 API 时 SHALL 能读取该文件内容并作为 `Runtime.evaluate` 的 expression 或等价注入单元使用（错误时返回可机读错误码）

### Requirement: 手动注入入口（UI 按钮）

Studio Web SHALL 在文档化位置提供 **「注入 rrweb 录制包」**（或等价文案）操作，对当前选中的 **会话与 page target** 触发一次注入；用户 SHALL NOT 需要手动粘贴 bundle 全文。操作 SHALL 仅在 **Bearer 已配置** 且会话满足 **运行中、CDP 可用、allowScriptExecution 为 true** 时可成功发起（否则 SHALL 展示可理解错误）。

#### Scenario: 成功调用注入 API

- **WHEN** 用户已选择 running 会话与有效 targetId 且 allowScriptExecution 为 true，并点击注入按钮
- **THEN** 客户端 SHALL 向 Core 发送文档化的注入请求且收到成功响应（HTTP 2xx），且随后页面内 SHALL 存在可验证的录制启动语义（例如 binding 注册或约定全局钩子，验证方式以实现与测试约定为准）

### Requirement: rrweb 事件鉴权传输

rrweb 录制产生的事件流从页面送达 Studio 的过程 SHALL **经 Bearer 保护的 Control API 或等价已鉴权通道**；无效或缺失令牌 SHALL NOT 建立订阅或拉流。系统 SHALL 对并发或速率施加 **可文档化的上限**，超限时 SHALL 返回可机读错误且不导致进程崩溃。

#### Scenario: 无效令牌无法订阅 rrweb 流

- **WHEN** 客户端使用无效或缺失的 Bearer 请求 rrweb 事件流或回放 API
- **THEN** 服务器 SHALL 拒绝请求并返回文档化的 HTTP 状态与错误体

### Requirement: Studio 侧 DOM 重放与指针同屏

Studio SHALL 使用 **`@rrweb/replayer`（或文档选定的兼容组件）** 在 **同一预览容器** 内重放 rrweb 事件；指针或点击 overlay（来自既有或扩展的指针事件）SHALL 与回放内容 **共享同一视口坐标系映射**（以录制侧上报的视口宽高与容器尺寸为基准），第一期 SHALL NOT 要求像素级视频镜像。

#### Scenario: 容器内同时存在重放层与 overlay

- **WHEN** 用户已打开 rrweb 预览且存在至少一条指针类事件与可重放事件批次
- **THEN** 界面 SHALL 在同一预览区域内同时展示 Replayer 渲染结果与指针或点击 overlay，且 SHALL NOT 将二者拆到无坐标关联的两个独立页面（除非文档声明的例外）

### Requirement: 隐私默认

rrweb `record` 初始化 SHALL **默认启用**文本与输入等隐私相关配置（具体键名随 rrweb 版本在实现与 `docs/API.md` 中列出）；产品文档 SHALL 说明默认本地与脱敏语义。

#### Scenario: 默认配置可查询

- **WHEN** 维护者阅读 `docs/API.md` 或等价文档中 rrweb 小节
- **THEN** 文档 SHALL 列出默认隐私相关选项名称及含义（与实现一致）
