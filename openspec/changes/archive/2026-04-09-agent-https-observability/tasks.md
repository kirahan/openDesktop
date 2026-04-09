## 1. CDP 网络采集与聚合

- [x] 1.1 在 `packages/core/src/cdp/` 实现 Network 域短时订阅：配对 `requestId`、计算耗时与 `maxConcurrent`，并施加条数/长度上限
  - [x] Test: 单元测试覆盖合成事件序列（AC：窗口内总数、慢请求过滤、并发峰值、截断标记）
- [x] 1.2 导出稳定 TypeScript 类型（聚合结果 JSON 形状），供 HTTP 层复用

## 2. Agent HTTP 集成

- [x] 2.1 在 `registerObservability.ts` 注册新 canonical 动作（与 `network` Cookie 分离），校验 `targetId`、`windowMs`、可选阈值参数
  - [x] Test: `recipes.http.test` 同级或扩展现有 `agentActions.http.test.ts`：成功 mock、会话 404、CDP 失败路径
- [x] 2.2 将新动词加入 `agentActionAliases.ts` 与 `GET /v1/version` 列表（若由单源生成则改单源）
  - [x] Test: 快照或断言 `listAgentActionNamesForVersion` / version 路由含新动词

## 3. 文档与收尾

- [x] 3.1 更新根 `README.md` Agent 表：新动作字段说明、与 `network`（Cookie）区别
  - [x] Test: 无（文档）；或仅 lint
