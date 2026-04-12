## 1. 协议与数据结构

- [x] 1.1 定义录制事件与结构快照的 JSON schema（版本字段、坐标系、事件类型枚举、时间戳）
  - [x] Test: 单元测试校验 schema 解析与拒绝非法 payload（缺字段、错误坐标类型）

## 2. Core：采集与推送

- [x] 2.1 实现录制会话状态（按 sessionId + targetId）与注入/卸载 recorder 的生命周期
  - [x] Test: 集成测试：mock CDP 或 fixture 页面，验证未开启录制时不注入；开启后注入调用发生
- [x] 2.2 实现 pointer 降采样与 click 记录，并合并结构快照生成逻辑
  - [x] Test: 单元测试：给定原始 move 序列，输出长度符合上限策略
- [x] 2.3 新增经 Bearer 鉴权的实时推送端点（SSE 或 design 选定协议），含并发上限与 429
  - [x] Test: HTTP 测试：有效 token 可建立连接；无效 401/403；超限 429

## 3. Web：矢量预览

- [x] 3.1 增加录制流订阅 UI（入口、订阅、清屏、错误提示），展示事件与快照文本
  - [x] Test: 组件测试：mock 流数据追加列表；清屏仅清空本地视图（与 spec 一致）
- [x] 3.2 在预览区实现指针或点击点的 overlay（基于视口坐标与容器缩放）
  - [x] Test: 组件测试：给定固定事件坐标，overlay 位置与缩放后容器几何一致（容许文档化误差）

## 4. 文档与对账

- [x] 4.1 更新 `docs/API.md` 或等价文档描述新端点与 payload
  - [x] Test: 文档中的示例 JSON 可被 schema 测试用例解析通过

## 5. 归档准备

- [x] 5.1 实现完成后运行 `openspec reconcile` 或按项目流程对账 spec 与代码
  - [x] Test: CI 中现有测试套件通过，新增测试全部绿灯
