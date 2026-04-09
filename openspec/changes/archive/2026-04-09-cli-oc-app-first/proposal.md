## Why

用户与自动化脚本已习惯 `**yarn oc <appId> <子命令>**`（App-first）路径：按**已注册应用 id** 解析活跃会话，无需手写 `sessionId`，即可执行 `list-window`、`metrics`、`snapshot`、`list-global` 等。该形态应在规格中**显式固化**，并约定**新增子命令时的扩展方式**（含与未来 Agent 能力如 `explore` 的 CLI 对齐），避免仅散落在实现里导致文档与行为漂移。

## What Changes

- 新增 capability 规格：**Core CLI SHALL 支持 App-first 调用形式**，文档化保留字、子命令集合、与 `yarn oc`（`packages/core` 经 workspace 暴露的 `cli` 脚本）及全局入口 `od` 的关系。
- **设计层**明确：`parseAppFirstArgv` / `runAppFirst` 为单一注册点；新增子命令须同步 `APP_FIRST_COMMANDS`（或等价常量）、`runAppFirst` 分发、帮助/README、单测。
- **不改动**现有子命令的 HTTP 语义；本变更以**规格 + 可追溯任务**为主；若实现与 spec 有缺口，在 apply 阶段按 tasks 补齐（例如未知子命令时的错误可读性）。

## Capabilities

### New Capabilities

- `cli-oc-app-first`：定义 App-first 语法、保留 `appId` 集合、子命令集合与别名（如 `topology`）、以及「扩展新子命令」时对 spec/README/测试的要求。

### Modified Capabilities

- （无）—— 不修改既有 HTTP/Agent 等主 spec 文本。

## Impact

- **packages/core**：`cli.ts`、`cli/parseAppFirstArgv.ts`、`cli/appFirstRun.ts`、相关 `*.test.ts`；根目录 `README.md` 中 App-first 小节与示例对齐 spec 用词。
- **对外心智**：用户文档统一推荐使用 `**yarn oc <appId> <command>`**（与仓库 README 一致）；说明 `od` 为同一 CLI 的 `bin` 名。