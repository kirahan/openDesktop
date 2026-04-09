## Context

- 根目录 `package.json` 提供 `yarn oc` → `yarn workspace @opendesktop/core cli`（tsx 跑 `src/cli.ts`）；`@opendesktop/core` 的 `bin` 名为 **`od`**（`dist/cli.js`）。
- 已实现：`tryParseAppFirstArgv` 识别 **`[flags...] <appId> <subcommand>`**，其中 `appId` 不得为保留顶层名（`core`、`app`、`session` 等）；`APP_FIRST_COMMANDS` 含 `snapshot`、`list-window`、`topology`（兼容别名）、`metrics`、`list-global`。
- `runAppFirst` 负责解析会话、调用观测 API。

## Goals / Non-Goals

**Goals:**

- 规格与代码一致：`yarn oc <appId> list-window|metrics|snapshot|list-global` 及 `topology` 别名行为有**可测**描述。
- **扩展约定**：新增 App-first 子命令时，必须更新：常量集合、分发逻辑、README 表格/示例、解析单测；若对应 Agent 动词，在文档中交叉引用。
- 帮助信息：`--help` 或 README 中**显式**列出 App-first 形式（避免用户只知 `od session` 而不知 `oc my-app list-window`）。

**Non-Goals:**

- 不在此变更重命名 `od` bin 或新增第二个 bin（避免破坏全局安装用户）。
- 不强制实现「未知子命令时」与 Commander 错误信息完全统一（可作为可选改进任务）。

## Decisions

1. **用户可见主范例：`yarn oc`**  
   - README 与错误提示优先使用 `yarn oc`，与团队习惯一致；注明等价于 `node …/cli` / `od`（若 PATH 已配置）。

2. **子命令注册表：`APP_FIRST_COMMANDS` + `AppFirstSubcommand` 联合类型**  
   - 新增子命令必须同时改类型与 Set，编译期与测试双保险。

3. **与 `agent-dom-explore` 的关系**  
   - 若后续增加 Agent 动词 `explore`，**可选**增加 App-first 子命令 `explore`（同一 change 或 follow-up）；本 change 的 tasks 可含「占位：文档中说明扩展点」，不阻塞本提案合并。

4. **保留字列表：`RESERVED_TOP_LEVEL`**  
   - 与 Commander 顶层命令对齐；`appId` 命中保留字时**不得**进入 App-first（避免误解析）。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| App-first 与 Commander 争抢 argv | 维持「先 tryParseAppFirstArgv，非 app-first 再交给 commander」顺序；单测覆盖边界 |
| 文档写 `oc` 但用户只装 `od` | README 脚注说明 `yarn oc` 为 monorepo 脚本 |

## Migration Plan

- 无数据迁移；纯 additive 规格与文档对齐。

## Open Questions

- 是否在 CLI `--help` 顶部增加三行「App-first 速查」（实现成本 vs 可发现性）。

## Testing Strategy

- **单元**：已有 `parseAppFirstArgv.test.ts` / `appFirstRun` 相关测例——按 spec 补全场景（非法子命令、保留 appId、`topology` 别名）。
- **位置**：`packages/core/src/cli/*.test.ts`（Vitest）。
