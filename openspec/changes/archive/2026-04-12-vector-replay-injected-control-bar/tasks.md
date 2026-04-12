## 1. Schema 与协议

- [x] 1.1 在 `session-replay/schema` 中增加 `assertion_checkpoint`（或设计稿最终命名）信封解析与校验；非法行拒绝或跳过并记录
  - [x] Test: `schema.test.ts` 覆盖合法与非法样例（对应 spec：Checkpoint emits structured line）

## 2. Core 注入与 Binding

- [x] 2.1 扩展 `startPageRecording` 注入：可选注入控制条 DOM（极简样式）及 `__odReplayControlBar` 根节点；在 `replay` 事件监听路径上过滤 `controlRoot.contains(target)`
  - [x] Test: `recordingService.test.ts` 注入脚本字符串断言（控制条与 `odFromControlBar`；对应 spec：Control bar interactions not recorded）
- [x] 2.2 新增 UI 专用 `Runtime.addBinding`（名称在实现中与 design 一致）；在 `bindingCalled` 中区分数据 binding 与 UI binding；实现 `stop` 命令调用 `stopPageRecording`
  - [x] Test: 与 3.1 及 `parseReplayUiCommand` 单测覆盖（集成点见 `createApp` + `recordingService`）
- [x] 2.3 实现 `checkpoint`（或等价）命令：向当前录制的订阅者推送 `assertion_checkpoint` 行
  - [x] Test: `schema.test.ts` + `parseReplayUiCommand` 单测（对应 spec：Assertion checkpoint signal）
- [x] 2.4 `__odReplayCleanupV1` 扩展：移除控制条 DOM、移除 UI binding、与现有清理顺序无竞态
  - [x] Test: 注入脚本含 `controlRoot` 移除；`ActiveRecording.close` 条件移除 UI binding

## 3. HTTP API

- [x] 3.1 `POST .../replay/recording/start` 支持可选字段（如 `injectPageControls: boolean`），默认为 false；传入 true 时注入控制条
  - [x] Test: `createApp.test.ts` 扩展用例，断言请求体传递至录制启动路径（或等价集成点）

## 4. 文档

- [x] 4.1 更新 `docs/API.md`：说明 `injectPageControls`、新 binding 语义、`assertion_checkpoint` 行格式与安全说明
  - [x] Test: `docs/readmeLinks` 或链接检查脚本仍通过（若仓库已有）

## 5. Web（可选）

- [x] 5.1 实时观测或会话相关 UI 增加「页面内控制条」开关，默认关；开启时对 `replay/recording/start` 传 `injectPageControls: true`
  - [x] Test: Web 侧为手动验证；逻辑与 Core HTTP 测试一致
