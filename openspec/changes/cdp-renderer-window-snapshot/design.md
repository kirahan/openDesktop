## Context

OpenDesktop Core 已通过 CDP 连接 Electron 调试端口，并在 `browserClient` 中实现 `evaluateOnTarget`（`Runtime.evaluate`，`returnByValue: true`）。Agent 已有 `eval` 等动作。本变更在此基础上增加**专用、结构化**的「全局对象反射」结果，避免调用方手写冗长且易错的 `expression`，并统一输出 schema。

## Goals / Non-Goals

**Goals:**

- 在指定 **targetId** 对应会话上，返回可 JSON 序列化的快照：`globalThis` 沿原型链合并后的属性名列表、每项 `typeof`、对 `function` 尽量附带 `name`（读 `.name`，失败则省略）。
- 可选 **interest 正则**（由 Core 在 Node 侧编译或校验后传入表达式，避免注入）：在快照中额外给出 `interestMatches` 列表。
- 上限保护：**最大属性条数**（超出则 `truncated: true` 并截断列表），防止极端页面拖垮响应。
- Agent 动词 + 可选 CLI，行为与现有 `eval` 的权限模型一致。

**Non-Goals:**

- 不实现跨进程的「live `window` 代理」；明确为 **CDP 反射快照**。
- 不在此动作内自动调用 `acquireShellApi()` 或任意用户函数（避免副作用）；若需试探调用，仍用既有 **`eval`** 或后续独立动作。
- 不解决 **world id / iframe** 选错导致「看不到 preload 注入」的问题（调用方需选对 target；可在响应中附带 `executionContextId` 若未来扩展，本阶段非必须）。

## Decisions

1. **实现载体：专用 CDP 函数 + `returnByValue`**  
   - **理由**：与现有 `evaluateOnTarget` 一致，结果可 JSON 化；便于单测时抽离「生成器字符串」或内联 IIFE。  
   - **备选**：`Runtime.getProperties` 针对 `globalThis` 的 remote object——步骤更多，且与 `returnByValue` 单次往返相比收益有限。

2. **动词名：`renderer-globals`（canonical）**  
   - **理由**：与 `window-state` 并列，语义表示「渲染侧全局命名空间探测」。  
   - **备选**：`global-snapshot`——更短但与「仅 globals」略歧义。

3. **请求体字段（建议）**  
   - `targetId`（必填，与现有 actions 一致）。  
   - `interestPattern`（可选）：字符串形式的正则，**仅在 Core 侧校验**（长度上限、禁止 `eval` 构造等），再嵌入预定义脚本模板。  
   - `maxKeys`（可选，默认如 8000）：截断阈值。

4. **CLI 形态**  
   - 新增 **`od agent action <sessionId>`**（或挂在 `session` 下），通过 stdin 或 `--json` 传入 body，与 `curl` 等价但减少样板。  
   - **理由**：仓库已有 `od session create` 等，Agent 目前主要靠 HTTP，CLI 补齐「命令行可脚本化」。  
   - **备选**：仅文档化 `curl`——实现成本更低，但不符合「封装成命令」的诉求。

5. **权限**  
   - 与 **`eval`** 对齐：若 Profile 对脚本执行有限制，本动作应同样拒绝或返回 403/业务错误码（以现有实现为准）。

## Risks / Trade-offs

- **[Risk] 正则 ReDoS 或恶意 pattern** → **Mitigation**：限制 pattern 长度；用 `new RegExp` try/catch；仅用于 `String.prototype.match` 或 `test` 过滤已有字符串列表，不对用户输入执行 `eval`。  
- **[Risk] 超大 `window` 拖慢页面** → **Mitigation**：`maxKeys` + 超时沿用 `BrowserCdp` 现有策略。  
- **[Trade-off] 看不到闭包内未挂 `window` 的 API** → 文档与 spec 写明：本能力仅探测 **globalThis 可枚举暴露**。

## Migration Plan

- 新版本 Core 部署后即生效；旧客户端忽略未知动词即可。无数据迁移。

## Open Questions

- `interestPattern` 是否支持 **多段** 或 **固定白名单**（如仅 `acquire|shell|ksxz`）以减少 ReDoS 面——可在 apply 阶段定默认策略。

## Testing Strategy

- **单元测试**：将「快照序列化」逻辑抽成纯函数（输入为模拟的全局描述或表达式输出），覆盖：去重排序、`typeof` 分支、`maxKeys` 截断、interest 过滤。  
- **HTTP 集成测试**：沿用 `agentActions.http.test.ts` 风格，mock `withBrowserCdp` / `evaluateOnTarget` 返回固定快照，断言 `POST .../actions` 的 `renderer-globals` 分支与响应 JSON。  
- **文件位置**：`packages/core/src/cdp/` 旁或 `__tests__/`；与现有 Core 测试命令一致。
