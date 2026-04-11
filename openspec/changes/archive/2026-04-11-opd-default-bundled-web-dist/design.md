## Context

`@hanzhao111/opendesktop` 已通过 `prepublish-sync` 打入 **`dist/`** 与 **`web-dist/`**。`loadConfig` 当前对 `webDist` 为 **`overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST`**（见 `packages/core/src/config.ts`），**不包含**随包目录的自动探测。`core start` 在 `cli.ts` 中把 Commander 选项传入 `startDaemon`；未传 `--web-dist` 且未设环境变量时，用户需手写长路径才能启用 Web UI。

## Goals / Non-Goals

**Goals:**

- 在 **`opd core start`** 中实现 **`webDist` 有效值** 的解析优先级：**CLI `--web-dist`** 优于 **`OPENDESKTOP_WEB_DIST`** 优于 **CLI 入口文件旁 `../web-dist`**（探测成功条件见下）。
- 与 `loadConfig` **单一数据源**：避免 `webDist` 被 **flag、env、默认值** 重复合并；推荐在 **`cli.ts` 的 `core start` action** 内先算 **`effectiveWebDist`**，再以 **`Partial<CoreConfig>` 的 `webDist` 一次传入** `startDaemon`，使 `loadConfig` 内 **`overrides.webDist ?? env`** 中：若已在 CLI 层合并 env 与 bundled，则**仅传最终值**或明确约定 **仅传 flag，env 仍由 loadConfig 读取**——二者择一，**禁止** env 覆盖已解析的 bundled 或相反的双重应用。

**推荐实现（决策）**：在 **`cli.ts`** 计算：

```text
effective = opts.webDist ?? process.env.OPENDESKTOP_WEB_DIST ?? resolveBundledWebDist()
```

其中 `resolveBundledWebDist()` 使用 **`import.meta.url`** 定位 **`dist/cli.js`** 所在目录，取 **`join(dirname, '..', 'web-dist')`**，若存在约定入口文件（如 **`index.html`**）则返回 **绝对路径**，否则 **`undefined`**。将 **`{ webDist: effective }`** 作为 **唯一** 与 Web 相关的 override 传入 **`startDaemon`**；**不在此路径上**再让 `loadConfig` 单独读 env 拼接 bundled（即 **`startDaemon` 收到的 `overrides.webDist` 已是最终值** 时，`loadConfig` 中 **`webDist` 一行** 应等价于 **`overrides.webDist`**，或先调整 `loadConfig` 签名/分支，避免 **`overrides.webDist ?? env`** 在已传入合并值时再次误读 env）。**最小改动路径**：若保持 `loadConfig` 不变，则 CLI 传入的 `overrides` 中 **`webDist` 仅在「已算好 effective」时设置**，且 **显式传 `undefined` 与未传** 区分需谨慎；更干净做法是 **`loadConfig` 增加可选 `bundledWebDist` 参数** 或在 **`startDaemon` 内** 先于 `loadConfig` 合并三者——在 design 里锁定一种并写进 tasks。

**落地选择（供实现锁定）**：优先 **`startDaemon` / `core start` 调用链** 上传入 **`overrides: { webDist: effectiveWebDist }`**，其中 **`effectiveWebDist`** 在 **`cli.ts`** 按上式计算；**调整 `loadConfig`** 为 **`webDist: overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST`** 仅在 **未** 由 CLI 预合并时生效——若 CLI 总是传入合并后的单值，则 **`loadConfig` 应改为** `webDist: overrides.webDist !== undefined ? path.resolve(overrides.webDist) : (process.env.OPENDESKTOP_WEB_DIST ? path.resolve(...) : undefined)` **不对**：若 `effective` 已含 env，直接 **`webDist: overrides.webDist ?? env`** 且 CLI **总是传入 `effective`**（含 `undefined`），则 **env 永远不会被 loadConfig 读到**——因此 CLI 必须在 **`effective` 计算时** 显式包含 **`process.env.OPENDESKTOP_WEB_DIST`**，这样 **`loadConfig` 内不再读 env** 或 **保留 env 仅当 override 未传**。最简单：**CLI 算出 `effective` 字符串或 undefined，传 `startDaemon({ webDist: effective })`，`loadConfig` 改为 `webDist = overrides.webDist !== undefined ? resolve(overrides.webDist) : undefined` 且不再读 `OPENDESKTOP_WEB_DIST`** 会破坏其他调用方——需检查 **`startDaemon` 全部调用**。

**较稳妥**：保持 **`loadConfig`** 的 **`overrides.webDist ?? env`**，**仅在 `cli.ts` 的 `core start`** 中传入 **`webDist: opts.webDist ?? bundledOnlyIfNoEnv()`** 不对——env 优先级高于 bundled，故：

```
if (opts.webDist) use flag;
else if (process.env.OPENDESKTOP_WEB_DIST) use env; // loadConfig can handle
else use bundled;
```

若 **`else if env`** 交给 **`loadConfig`**，则传入 **`startDaemon` 时不传 webDist override，仅传 bundled 探测结果当 **第三顺位**——**实现**：**`startDaemon` 接收 `webDist?: string`**，内部 **`loadConfig({ ...overrides, webDist: overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST ?? bundled })`** 需在 **daemon** 层调 **`resolveBundled`**，或 **CLI 层传入最终值**。

**结论（写入 tasks）**：在 **`cli.ts`** 实现 **`resolveEffectiveWebDist(opts)`** 返回 `string | undefined`，并 **单次** 传入 **`loadConfig` 兼容的 overrides**；若 **`loadConfig` 仍含 `?? env`**，则 **CLI 传入的 override 已包含 env 与 bundled 的合并结果**，此时 **`loadConfig` 必须不再追加 env**——故 **需改 `loadConfig` 一行**为：仅当 **`overrides.webDist` 未定义** 时使用 env，**若 CLI 已传入定义值（含空字符串？）** 需约定。**最简**：**`loadConfig` 的 `webDist`** 改为 **`overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST`**，**CLI 只传 `overrides.webDist = flag ?? bundled`**，**env 仍由 loadConfig 读**——则优先级变成 **flag > env > 无法实现 bundled in loadConfig**。故 **bundled 必须在 CLI 合并**：**`effective = flag ?? env ?? bundled`**，传入 **`startDaemon({ webDist: effective })`**，**`loadConfig` 使用 `webDist: overrides.webDist`** **不再** 读 **`OPENDESKTOP_WEB_DIST`**，或 **`webDist: overrides.webDist ?? process.env`** 在 **effective 已合并时 CLI 传入的 overrides.webDist 已最终** → **传 `effective` 后 `loadConfig` 应只使用 `overrides.webDist`**。检查 **`loadConfig` 其他调用**：若别处依赖 env，保留 **`overrides.webDist ?? env`**，**CLI 传 `effective` 时已含 env**，则 **`overrides.webDist` 非 undefined 时跳过 env**——当前代码 **`overrides.webDist ?? env`**：**若传 `effective` 字符串，env 忽略** ✓；**若 `effective` 为 undefined**，仍读 env ✓；**bundled 为第三**：**`effective = flag ?? envFromCli ?? bundled`**——**env 不能在 loadConfig 读两次**：**`effective = flag ?? process.env.OPENDESKTOP_WEB_DIST ?? bundled`**，传入 **`startDaemon({ webDist: effective })`**，**`loadConfig`：`webDist: overrides.webDist`** **且删除 env 行** 或 **`webDist: overrides.webDist !== undefined ? resolve(overrides.webDist) : resolve(env)`**——**统一为 `webDist: overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST` 在 startDaemon 包装层传入的 overrides 已带最终值** 时 **应** **`overrides.webDist` 优先包含全部逻辑**。

**实现定稿**：在 **`cli.ts`** 计算 **`const webDist = opts.webDist ?? process.env.OPENDESKTOP_WEB_DIST ?? resolveBundled()`**；**`startDaemon({ ..., webDist })`**；**`loadConfig`** 保持 **`webDist: overrides.webDist ?? process.env.OPENDESKTOP_WEB_DIST`** 会导致 **env 二次**：若 **`opts.webDist` 未设** 且 **设了 env**，**第一式已取 env**，**override 有值**；若 **未设 env**，**override 为 bundled**；**loadConfig 再次 `?? env`** 仍一致。**若 flag 未设、env 设了**，**第一式取 env**，**override 有值**，**loadConfig `?? env`** 冗余但一致。**若都未设**，**override 为 bundled or undefined**，**loadConfig `?? env`** 仍可对。**唯一问题**：**第一式未读 loadConfig 的 path.resolve**——**CLI 层应对三者 **path.resolve**。** **`loadConfig` 仍有 `webDist ? path.resolve`**——**可保留**。

**Non-Goals:**

- 不修改 Vite/Web 源码；不改变 **`web-dist` 目录结构**（仍由现有 sync 产生）。
- 不在此变更实现 **默认端口** 或 **HTTPS**。

## Decisions

| 决策 | 选择 | 备选 |
|------|------|------|
| 探测路径 | **`dirname(cli.js)` 的上一级目录下的 `web-dist`**，存在 **`index.html`** 则启用 | 可配置清单文件名（非本阶段） |
| 提示文案 | **`core start` 成功块** 根据 **`config.webDist` 是否设置** 分支 | 单一文案 |
| 文档语言 | 中英 README、`docs/CLI.md`、`packages/opendesktop/README` 同步 | 仅英文 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Monorepo 下 **`yarn opd` 指向 `packages/core/dist/cli.js`**，旁无 **`web-dist`**，仍为仅 API | 文档说明；与现行为一致 |
| **`import.meta.url`** 在打包/单文件场景失效 | 当前为 Node ESM **未** bundle CLI；若未来 bundle 需重审 |
| 用户误以为 **env 可覆盖 flag** | 优先级写进 CLI 手册与 spec |

## Migration Plan

- **向后兼容**：显式 **`--web-dist`** 与 **`OPENDESKTOP_WEB_DIST`** 行为不变；新增 **第三顺位** 仅在二者均未提供且探测成功时生效。
- **回滚**：还原 **`cli.ts`** 与文案；无需数据迁移。

## Open Questions

- 是否在 **`doctor`** 或其它子命令中提示「检测到随包 Web」——本阶段可不做。

## Testing Strategy

- **单元**：**`resolveBundledWebDist`**（或等价逻辑）在 **存在/缺失 `web-dist/index.html`** 下的返回值；**mock `import.meta.url`** 或 **文件系统夹具**。
- **集成**：**`core start`** 在临时目录下 **伪造** `dist/cli.js` 与 **`../web-dist`** 布局（或通过 **vitest** 调用 **node 子进程** 跑 CLI）验证 **HTTP 对 `/` 返回 HTML**（可选，成本较高时以 **单元 + 手工** 为主）。
- **回归**：现有 **`@opendesktop/core`** 测试全绿；**README 链接** 脚本通过。
