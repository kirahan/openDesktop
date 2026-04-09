## Context

Core 已支持 `Runtime.evaluate`、`Runtime.consoleAPICalled`（短时采样与 SSE 流），但未订阅 **`Runtime.exceptionThrown`**，也未从 `consoleAPICalled` 提取 **`stackTrace`**。Chrome DevTools Protocol 中，异常对象常带 `exceptionDetails.stackTrace.callFrames`，可用于 Agent 的结构化展示。

## Goals / Non-Goals

**Goals:**

- 在 Agent 可调用的动作下，返回 **结构化调用栈**（帧数组：函数名、脚本 URL、行号、列号等，以 CDP 字段为准）。
- 覆盖至少一类来源：**未捕获异常**（`exceptionThrown`）；**可选**：`console.error` 等若带栈则解析。
- 明确 **条数、字符串长度** 上限，防止超大栈拖垮进程。

**Non-Goals:**

- 不实现完整 **异步链** 还原（`async` 跨 await 的业务链需业务埋点，本变更不承诺）。
- 不在本变更中定义 **与 HTTPS 观测的自动关联**（时间轴对齐可作为后续集成）。

## Decisions

1. **主来源**  
   - **决策**：以 `Runtime.exceptionThrown` 为主路径；监听前 `Runtime.enable`。  
   - **理由**：与「报错自动拿栈」需求最直接一致。

2. **采样窗口**  
   - **决策**：与 `console-messages` 类似，采用 **短时窗口**（`waitMs` 有上限）收集异常；或单次拉取「自监听起的下一条异常」（实现二选一并写入 spec）。  
   - **理由**：避免常驻监听与 Agent 长轮询复杂度；后续可扩展 SSE。

3. **与 `allowScriptExecution`**  
   - **决策**：与现有 `eval` 等对齐，**需要** `allowScriptExecution: true` 才允许订阅（若团队认定 exception 监听为只读、可放宽，需在 spec 修改并评审）。

4. **脱敏**  
   - **决策**：对 `url` 类字段可做与网络观测一致的 strip/hash 策略（design 层引用，具体在实现中共享工具函数若存在）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 第三方压缩脚本行号不准 | 文档说明「以 CDP 为准」 |
| 敏感路径泄露 | 长度限制 + 可选哈希 |

## Migration Plan

新增 API，无迁移。

## Open Questions

- MVP 是否包含 **console 带栈**：若工作量可控可一并写入 spec 的 ADDED Scenario。

## Testing Strategy

- **单元测试**：解析 CDP 样例 payload → 稳定 JSON 形状。
- **HTTP 测试**：mock CDP，覆盖 403（脚本禁用）、空窗无异常、单异常多帧。
- **位置**：`packages/core/src/cdp/*stack*.test.ts`、`packages/core/src/http/agentActions.http.test.ts` 或专用文件。
