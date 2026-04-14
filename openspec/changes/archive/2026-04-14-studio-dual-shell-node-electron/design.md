## Context

- **现状**：`packages/core` 提供 HTTP API 与静态 Web 托管；`packages/web` 为 SPA；用户通过 `opd core start` 或等价命令启动后，用浏览器访问。
- **目标**：在 **不大改 monorepo 顶层布局**（仍以 `packages/core`、`packages/web` 为主）的前提下，增加 **Electron 壳**作为第二基座，与现有 Node+浏览器路径 **长期并存**。
- **约束**：Core 业务与 Web UI **单真源**；Electron **不** fork Core/Web 源码树。

## Goals / Non-Goals

**Goals:**

- 双基座：**Node 基座**（手动/脚本启动 Core + 外置浏览器）与 **Electron 基座**（壳内 spawn Core + 内嵌 BrowserWindow）均可运行同一 Web 与同一 API。
- **能力探测**：渲染进程可判断 `shell.kind`（如 `browser` | `electron`），以便 **可选**启用增强能力。
- **差异化（首版至少一项）**：Electron 下 **选择可执行文件** 可走 **`dialog.showOpenDialog`**（main），返回路径供表单使用；浏览器基座 **不改变**既有降级（Core 辅助接口或手输）。
- **生命周期**：退出 Electron 时 **可靠终止**子进程 Core，释放端口。

**Non-Goals:**

- 首版 **不要求**实现全局快捷键、透明 overlay、多窗口布局（可列为后续变更）。
- **不要求**将 Core 合并进 Electron main 进程（仍保持子进程 + HTTP）。
- **不要求**修改 `opd-bundled-web-default` 的规范条文（通过环境变量约定对齐）。

## Decisions

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 壳代码位置 | 新建 `packages/studio-electron-shell`（或 `electron-host`，以最终实现名为准） | 根目录 `apps/` 独立仓 | 与现有 `packages/core`、`packages/web` 并列，改动面集中、workspace 易加一项。 |
| Core 启动方式 | `child_process.spawn` 调 **已构建的 `node …/cli.js core start`** 或 **项目内 `yarn`/可执行 `opd`**，由 `PATH` 与 `cwd` 约定 | 在 Electron 内 `require('@hanzhao111/opendesktop')` 直接调 API | 子进程方式 **复用现有 CLI 行为**（token、端口、web-dist 解析），与 Node 基座一致。 |
| Web 加载 URL | 优先 **`http://127.0.0.1:<corePort>/`**（与浏览器相同）；若仅 file 分发则 `loadFile` + Core 仍监听 | 仅 file | 与开发时同源策略、Cookie/存储行为一致；`loadURL` 简单。 |
| 能力暴露 | **`contextBridge` + 窄 API**（如 `pickExecutableFile(): Promise<string \| null>`） | 任意 `remote` | **安全**：不暴露 Node；预定义方法便于审计。 |
| Web 侧分支 | `if (window.__OD_SHELL__?.kind === 'electron')` 调 IPC，否则走现有 `fetch('/v1/pick-executable-path')` 等 | 全站重写 | **最小 diff**，浏览器路径零回归。 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Core 启动慢，窗口白屏 | 轮询 `GET /v1/version` 或 TCP connect 直至就绪再 `loadURL`；loading UI。 |
| 打包后 `node` / `cli.js` 路径错误 | `electron-builder` `extraResources` 放 Core 构建物；main 用 `app.getAppPath()` / `process.resourcesPath` 解析；文档写明开发 vs 生产路径。 |
| 双路径行为漂移 | Spec 要求 **注册应用**最终仍走同一 `POST /v1/apps`；仅「选路径」交互不同。 |
| 安全：file dialog 返回任意路径 | Web 仍做基本展示校验；Core **仍**校验可执行性（若已有）。 |

## Migration Plan

- **开发者**：无强制迁移；继续使用 Node 基座。
- **新增用户**：可选用 Electron 安装包（若发布）；与旧文档兼容。
- **回滚**：移除或停用 Electron 包即可；Core/Web 不受影响。

## Open Questions

- 是否首版即发布 **签名/notarized** macOS `.app`（超出本变更最小范围时可推迟）。
- Core 监听端口：固定 **8787** 与现有默认一致，或由壳传 **`OPENDESKTOP_PORT`**（若 Core 已支持）。
