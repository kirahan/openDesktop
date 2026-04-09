## 1. 契约与版本

- [x] 1.1 固化两条 SSE 的 **路径、query（`targetId`）、鉴权方式**，与 `console/stream` 对齐并写入 `design.md` 附录（若与初稿一致可仅补充最终路径字符串）
- [x] 1.2 扩展 `GET /v1/version`：增加可机读字段（如 `sseObservabilityStreams`），覆盖 **network** 与 **runtime-exception**；更新 `createApp.test.ts` 或等价断言

## 2. 限额与工具模块

- [x] 2.1 实现网络 SSE **并发获取/释放**（新建 limiter 或扩展现有模式，与控制台流 **分流计数**）
- [x] 2.2 实现网络 SSE **速率/条数** 背压与 **丢弃计数**（或 `event: warning`），保证「非静默丢光」
- [x] 2.3 实现异常栈 SSE **并发上限**（及可选每分钟条数上限 + 可机读警告）

## 3. CDP 与 HTTP

- [x] 3.1 实现 `runNetworkObservationStream`（或等价）：`AbortSignal`、错误回调、`ready`/`error` 事件语义与 `runConsoleMessageStream` 一致
- [x] 3.2 实现 `runRuntimeExceptionStream`（或等价）：仅在 `allowScriptExecution` 为 true 时允许；403 与 action 对齐
- [x] 3.3 在 `createApp.ts`（或 observability 注册处）注册 `GET .../network/stream` 与 `GET .../runtime-exception/stream`：SSE 头、`flushHeaders`、客户端 `close` 清理

## 4. 测试

- [x] 4.1 HTTP 集成测试：网络 SSE **ready**、会话 503/404、**429** 并发上限（可 mock CDP）
- [x] 4.2 HTTP 集成测试：异常 SSE **403**（`allowScriptExecution: false`）、成功路径栈帧结构（mock）
- [x] 4.3 网络 SSE **背压**：模拟高频事件时断言 **warning/dropped** 可感知（或等价字段）
- [x] 4.4 回归：现有 `network-observe` / `runtime-exception` **POST** 行为无破坏

## 5. 文档与（可选）Studio

- [x] 5.1 更新 OpenCLI / Agent README：curl `curl -N` 示例与权限说明
- [x] 5.2 Studio Web：在 `packages/web/src/App.tsx` 扩展「实时观测」抽屉，与实时控制台同构接入 **HTTPS（network）** 与 **异常栈（runtime-exception）** SSE（多 tab、fetch 流、warning 行）

## 6. App-first CLI（归档前对齐）

> 与 proposal 中「CLI 可用 `curl -N`」并列：**`yarn oc <appId> …`** 提供同等能力的交互式入口；实现已完成，本节用于规格/设计补录与归档对账。

- [x] 6.1 在 `parseAppFirstArgv` / `AppFirstSubcommand` 中注册 **network / console / stack** 的 **observe（短时）** 与 **stream（SSE）** 子命令；未知子命令错误信息列出全集
- [x] 6.2 在 `appFirstRun` 中实现：`network-observe` → POST `network-observe`；`network-stream` → GET `network/stream`；`console-observe` → POST `console-messages`；`console-stream` → GET `console/stream`；`stack-observe` → POST `runtime-exception`；`stack-stream` → GET `runtime-exception/stream`；抽取 `resolveTargetForAppFirst` 与 `pumpSseGet` 复用
- [x] 6.3 参数：`--target`、`--session`；`network-observe` 沿用 `--window-ms` / `--slow-ms` / `--no-strip-query`；`network-stream` 沿用 `--no-strip-query` / `--max-events-per-second`；`console-observe` / `stack-observe` 支持 `--wait-ms`（100～30000）
- [x] 6.4 根 CLI `od --help` App-first 段落更新（短时 vs SSE、`stack` 需脚本权限等）
- [x] 6.5 测试：`packages/core/src/cli/parseAppFirstArgv.test.ts` 解析用例；`packages/core/src/cli/appFirstRun.test.ts` mock `fetch` 覆盖各子命令成功路径
