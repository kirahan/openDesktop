## 1. 数据模型与 Core 基础

- [x] 1.1 在 Core 会话/录制模型中定义「同 session 多 target 并行」状态与并发上限；事件结构含 `targetId`、`monoTs`、`seq`（或等价字段）
  - [x] Test: 单元测试校验状态迁移与拒绝超限并发（覆盖 session-replay-multi-target 并发与错误场景）

## 2. 采集与事件透传

- [x] 2.1 采集路径保证输入类事件在产生端携带 `targetId`；可选 `windowLabel` 与 design 对齐
  - [x] Test: 模拟双 target 事件流，断言无 targetId 的路径被拒绝或不可达

## 3. 合并时间线

- [x] 3.1 实现合并键 `(mergeTs, targetId, seq)` 与确定性排序；文档化 `mergeTs`
  - [x] Test: 单元测试同输入多次合并顺序一致；边界同 ms 多事件

## 4. 入点 / 出点 / 检查点

- [x] 4.1 持久化 API：`mergedTs`、`scope`、`targetId`（当 scope=target）；校验非法组合
  - [x] Test: 缺少 targetId 的 target 作用域请求返回可机读错误

## 5. Studio Web

- [x] 5.1 合并时间线视图与分轨视图；标记在两视图间语义一致（spec 验收）
  - [x] Test: 组件/集成测试覆盖双视图同一标记 ID；可选快照

## 6. 全局快捷键

- [x] 6.1 实现 design **D5** 默认策略；UI/文案说明多 target 下打点作用对象
  - [x] Test: 模拟多 tab / 多活跃 target，断言快捷键与按钮前置条件一致

## 7. 文档与回归

- [x] 7.1 更新 `docs/` 或 Studio 内帮助：多 target、merge、快捷键策略
  - [x] Test: 核心包与 web 现有 `yarn test` 全绿；新增用例不破坏单 target 路径
