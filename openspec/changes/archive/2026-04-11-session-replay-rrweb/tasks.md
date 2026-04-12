## 1. 构建与产物

- [x] 1.1 新增 rrweb 注入包构建目标（如 `packages/rrweb-inject-bundle` 或 core 资源构建），产出 `inject.bundle.js`（IIFE），锁定 `@rrweb/record` 版本并与 Web 端 `@rrweb/replayer` 主版本兼容
  - [x] Test: CI 或单测断言构建产物文件存在且非空（最小体积阈值可选）

## 2. Core：注入与事件管道

- [x] 2.1 实现从约定路径读取 `inject.bundle.js` 并对指定 `sessionId`+`targetId` 执行 `Runtime.evaluate`（或等价）的 HTTP API；403/503 语义与 `allowScriptExecution`、会话状态对齐
  - [x] Test: HTTP 单测：有效 Bearer + mock `getOpsContext` 时注入路径被调用；无效 401；脚本关闭 403

- [x] 2.2 为 rrweb 事件新增或扩展 CDP `Runtime.addBinding` 管道（独立 binding 名），Core 侧校验、限流与 SSE/Web 推送与 design 一致
  - [x] Test: 单元测试：非法 payload 丢弃；限流触发可观测错误码（与实现一致）

## 3. Web：Replayer 与同屏 overlay

- [x] 3.1 集成 `@rrweb/replayer`（或 `rrweb-player`），在单一容器内重放事件流；指针或点击 overlay 与 Replayer 根节点共享坐标映射策略
  - [x] Test: 组件或集成测试：mock 最小 rrweb 事件列表时容器渲染无抛错；overlay 与容器尺寸变化可文档化

## 4. Studio UI：注入按钮

- [x] 4.1 在拓扑或实时观测相关区域增加「注入 rrweb 录制包」按钮，调用 2.1 API；错误态与 loading 可辨
  - [x] Test: 组件测试：mock `fetch` 断言请求路径与方法；禁用态当无 token 或无会话上下文

## 5. 文档

- [x] 5.1 更新 `docs/API.md`：注入端点、rrweb 事件流端点、默认隐私选项键名、`inject.bundle.js` 版本说明
  - [x] Test: 文档中的示例请求体与错误码与 HTTP 测试或 schema 一致（可引用现有测试或手工 checklist）

## 6. 归档与验证

- [x] 6.1 运行 `openspec validate session-replay-rrweb` 与全量测试套件通过后再 archive
  - [x] Test: CI 绿灯作为验收
