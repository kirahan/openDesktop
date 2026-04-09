## 1. Core：控制台流与 CDP

- 1.1 实现单 `(sessionId, targetId)` 的 CDP 订阅模块：`Runtime.enable` + 监听 `Runtime.consoleAPICalled`，连接生命周期与并发上限（对齐 design 决策）
  - Test：单元测试 mock CDP 事件序列，断言序列化/队列截断/关闭时无泄漏（覆盖 AC：订阅成功后收到新日志、断开释放资源）
- 1.2 暴露 HTTP 流式端点（SSE 或 WebSocket，与 design 定稿一致）；Bearer 鉴权；错误码与「会话非 running」场景（覆盖 AC：503 可机读）
  - Test：集成测试：mock 或 fixture 会话 + 模拟控制台事件，验证 HTTP 客户端能读到事件流

## 2. Studio（Web）

- 2.1 在会话详情增加「实时控制台」区域：建立/关闭订阅、追加展示、清屏、加载与错误态（覆盖 AC：清屏、追加）
  - Test：组件测试或轻量集成：mock `EventSource`/WebSocket，验证追加与清屏行为

## 3. 文档与对齐

- 3.1 更新 README 或 PRODUCT：说明实时流 vs `console-messages` 短时采样；明确不包含 Network
  - Test：无强制；可选快照测试文档片段或跳过

## 4. 收尾

- 4.1 全量 `yarn test:unit`（或项目规定的 renderer/core 测试命令）通过
- 4.2 Self-check：对照 `specs/studio-live-console/spec.md` 每条 Requirement 至少有一条测试或手动验收记录

