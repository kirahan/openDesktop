# agent-observability-sse-streams

## 概述

**一句话**：为 HTTP(S) 网络元数据与运行时异常栈增加 **GET + SSE** 长连接观测，与现有 `console/stream` 先例对齐；网络流带 **背压与可感知限流**，短时 POST `network-observe` / `runtime-exception` 保持不变。

**背景与动机**：当前两类观测均为有界窗口的一次性采样，无法「tail」调试；控制台已证明 SSE 可行。网络 CDP 事件量可能极大，必须在服务端限流并让客户感知丢弃/警告。

**影响范围**：主要 `packages/core`（路由、CDP 流、limiter、测试）；可选文档与 Studio Web。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件（预期） |
|---|------|------|------------------|
| 1 | `GET .../network/stream` | 网络元数据 SSE，`ready` 后仅新事件 | `createApp.ts` 或 observability 注册、`cdp/*Stream.ts` |
| 2 | `GET .../runtime-exception/stream` | 异常+栈 SSE；403 与 action 一致 | 同上 |
| 3 | 限额模块 | 网络：并发 + 速率/条数 + 丢弃可感知；异常：并发 + 可选条数上限 | 新建 limiter / 扩展 `consoleStreamLimiter` 模式 |
| 4 | `GET /v1/version` | 暴露 SSE 能力可发现字段 | `createApp.ts`、测试 |
| 5 | 测试 | HTTP 集成 + 背压 + 回归 POST | `*.http.test.ts` 等 |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|---------------------|
| 路由归属 | `GET /v1/sessions/:id/.../stream` 与 console 并列 | 与现有鉴权、先例一致；不塞进 `POST actions` |
| 网络洪峰 | 丢弃 + 累计/警告，非无限阻塞 | 阻塞会拖死 CDP/Core |
| 历史 | 不提供 | 与 `console/stream` 一致；降低复杂度 |
| POST action | 保留不变 | 兼容脚本与现有 Studio |

### 技术细节

- SSE：`Content-Type: text/event-stream`，首包 `event: ready` + `note` 标明无历史；错误 `event: error`；断开 `req.on('close')` + `AbortSignal` 清理 CDP 订阅。
- 网络：默认不传 body；URL strip 与 `network-observe` 对齐；单条 payload 大小上限。
- 异常：`allowScriptExecution === false` → **403**，不建流。

## 验收标准

> 测试与产品验收以本节为准（摘自 `specs/cdp-observability-sse-streams/spec.md`）。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 网络 SSE 基本 | 建立网络 SSE 后页面发起新请求 | 收到含方法、URL（或 strip 后）与耗时/阶段字段的 `data` |
| 2 | 网络 SSE 会话不可用 | 会话不存在/非 running/CDP 未就绪 | 404/503，不建立无 `ready` 的长挂连接 |
| 3 | 网络 SSE 并发 | 并发连接已达上限后再连 | **429**，不建新流 |
| 4 | 网络 SSE 背压 | 短时事件超过速率上限 | 可丢弃，但客户端能区分无流量与限流，且有丢弃量或警告 |
| 5 | 异常 SSE 成功 | `allowScriptExecution` 为 true 且订阅后抛错 | 收到含文本与栈帧的 `data` |
| 6 | 异常 SSE 禁止脚本 | `allowScriptExecution` 为 false | **403**，不推送内容 |
| 7 | 异常 SSE 并发 | 并发达上限 | **429** |
| 8 | 异常 SSE 超限 | 单位时间异常过多（若实现条数上限） | 有警告或丢弃计数，非静默吞掉全部 |
| 9 | 断开释放 | 客户端关闭连接 | CDP 订阅与并发名额释放，可再次订阅 |
| 10 | ready 形状 | 流开始 | `event: ready` 的 data 含 `sessionId`、`targetId`、无历史 `note` |
| 11 | 版本可发现 | `GET /v1/version` | 存在文档化字段，枚举 network 与 runtime-exception SSE |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1.1 | 固化路径与 query | 与 console 对齐 | — |
| 1.2 | 扩展 `/v1/version` | 可发现字段 + 测试 | 1.1 |
| 2.1 | 网络并发 limiter | 分流计数 | — |
| 2.2 | 网络速率背压 | 丢弃可感知 | 2.1 |
| 2.3 | 异常并发/条数上限 | 轻量限制 | — |
| 3.1 | CDP 网络流 | Abort + 错误 | 2.x |
| 3.2 | CDP 异常流 | 403 规则 | 2.x |
| 3.3 | 注册 HTTP 路由 | SSE 头与清理 | 3.1–3.2 |
| 4.x | 测试套件 | 集成 + 背压 + 回归 | 3.x |
| 5.1 | README / curl 示例 | 文档 | 3.x |
| 5.2 | Studio（可选） | defer 可接受 | — |
| 6.x | App-first CLI | `yarn oc <appId>`：`network-*`、`console-*`、`stack-*` 短时与 SSE；见 `design.md` 附录 | Core CLI |

## 测试要点

- **429/403/503/404** 与成功路径 **ready + data** 均需覆盖。
- 网络 **背压** 必须断言「可感知」，不得仅测 200。
- **回归**：`network-observe`、`runtime-exception` **POST** 行为不变。
