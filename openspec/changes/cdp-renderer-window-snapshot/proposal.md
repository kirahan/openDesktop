## Why

在对接 Electron / koa-pc 等壳应用时，需要快速判断**渲染进程页面世界**里是否挂了 `acquireShellApi`、`KWindowManager` 等可自动化入口。仅靠人工 DevTools 不可复现、也难接入 Agent。通过 CDP `**Runtime.evaluate` + `returnByValue`** 做 **反射枚举**（不是跨进程持有「活的 window 引用」），可以把「有没有暴露面」变成**可脚本化、可回归**的一步，并为后续 `eval` 等动作提供依据。

## What Changes

- 在 Core CDP 层新增：**对指定 target 执行受控脚本**，收集 `globalThis`（沿原型链去重）上的 **属性名 + `typeof` 摘要**，可选按正则筛选「感兴趣」名称；结果 **仅 JSON 可序列化数据**（函数不传递闭包，只标记为 `function` 及可选 `name`）。
- 在 **Agent API**（`POST /v1/agent/sessions/:id/actions`）增加 canonical 动词（建议名：`renderer-globals`），与现有 `eval`、`window-state` 等一致，受同一套会话与 `**allowScriptExecution`**（若现有 eval 已约束则对齐）策略约束。
- 提供 **CLI 封装**（如 `od agent …` 或 `od session action …`），便于本地一条命令触发上述 HTTP，输出 JSON，供脚本与 OpenCLI 对齐使用。
- 更新 `**GET /v1/version` 的 `agentActions` 列表**与 README 动词表（若存在）。

**BREAKING**：无（新增能力，默认不改变既有动词行为）。

## Capabilities

### New Capabilities

- `cdp-renderer-global-snapshot`：通过 CDP 在目标渲染上下文反射枚举 `globalThis`/`window` 可观测属性，经 Agent 与可选 CLI 暴露，用于探测壳暴露 API。

### Modified Capabilities

- （无）当前仓库 `openspec/specs/` 下无已归档能力；本变更为新增 spec。

## Impact

- **代码**：`packages/core` 中 `cdp/browserClient.ts`（或邻近模块）、`http/registerObservability.ts`、`http/agentActionAliases.ts`；可选 `cli.ts` 新增子命令；`createApp` / version 聚合处若需列出新动词。
- **测试**：`@jest-runner/electron/main` 或现有 HTTP mock CDP 模式的对应用例；纯函数逻辑可单测。
- **文档**：根 `README.md` Agent 动词表；必要时 `docs/PRODUCT.md` 一句。

