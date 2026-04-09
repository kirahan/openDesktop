## Why

Agent 定位渲染进程问题时，仅有控制台字符串往往不够；需要 **JavaScript 调用栈**（未捕获异常或带栈的控制台输出）以缩小范围。当前 Core 未系统订阅 `Runtime.exceptionThrown`，也未解析 `consoleAPICalled` 中的栈信息。补齐后可与 HTTPS 观测等能力并列，作为排障闭环的一部分。

## What Changes

- 新增 **运行时栈采集与呈现**：在指定 CDP target 上订阅 CDP `Runtime` 相关事件，将 **结构化调用栈**（帧列表：函数名、URL、行号等，以 CDP 提供为准）通过 Agent API 返回或关联到现有日志流约定。
- 新增或扩展 **Agent HTTP 动词**（canonical 名与版本列表对齐），与现有 `eval`、`console-messages` 并存；默认行为与 **会话脚本权限**、**审计** 策略在 design 中明确。
- 文档：说明与 `console-messages` 的差异（历史不可回溯、栈字段可选）。

## Capabilities

### New Capabilities

- `cdp-runtime-stacks`：渲染进程异常/栈的结构化采集与对 Agent 的呈现（含边界：无栈时的降级语义）。

### Modified Capabilities

- （无）不修改现有 `studio-live-console` 的规范性要求；若未来与 SSE 合并，可在后续变更中做 MODIFIED。

## Impact

- **代码**：`packages/core/src/cdp/browserClient.ts` 或独立模块、`registerObservability.ts`、`agentActionAliases.ts`、测试与 README。
- **隐私**：栈中可能含路径与第三方脚本 URL，需在 spec 中约定长度与条数上限。
