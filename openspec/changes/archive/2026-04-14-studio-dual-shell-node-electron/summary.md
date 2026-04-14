# studio-dual-shell-node-electron

## 概述

**一句话**：在不大改 monorepo 的前提下，增加 **Electron 薄壳**与既有 **Node + 浏览器** 并存，共享同一 Core 与 Web；Electron 可通过 **preload** 提供 **原生选可执行文件** 等增强能力，浏览器基座 **降级不变**。

**背景与动机**：桌面场景需要系统弹窗、后续快捷键/overlay 等能力；双基座让用户既保留开发者熟悉的 Node 路径，又可选安装包式体验。Core/Web 业务保持单真源，避免分叉。

**影响范围**：新增 `packages/<electron-shell>/`、workspace 与脚本；`packages/web` 小范围分支；`packages/core` 原则上不改行为；文档补充。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件 |
|---|------|------|---------|
| 1 | Electron 壳包 | main：spawn Core、就绪检测、BrowserWindow、退出杀子进程 | `packages/studio-electron-shell/`（名称以实现为准） |
| 2 | preload | `__OD_SHELL__`、`pickExecutableFile` → `dialog` | `preload.ts`、`main` IPC |
| 3 | Web 分支 | 有 Electron 则原生选路径，否则原 HTTP/手输 | `packages/web` 注册/选路径相关 |
| 4 | 文档 | 双基座启动说明 | `docs/` 或根 README |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|---------------------|
| Core 集成方式 | 子进程跑现有 CLI `core start` | 与 Node 基座行为一致；不内嵌 Core 进 Electron |
| Web 加载 | `loadURL` 到 Core 根 URL | 与浏览器同源策略一致 |
| 差异化边界 | 仅「选路径」交互可本地化；`POST /v1/apps` 仍走 Core | 持久化与校验唯一真源 |

### 技术细节

- 主进程：`child_process.spawn`，env 可含 `OPENDESKTOP_WEB_DIST` 等（与 `opd-bundled-web-default` 约定对齐）。
- 就绪：轮询 `http://127.0.0.1:<port>/v1/version` 直至 `ok` 或超时。
- 安全：`contextBridge` 窄 API；不启用 `nodeIntegration` in renderer。

## 验收标准

> 测试与产品验收以本节为准。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | Node 基座 | 仅 `opd core start` + 浏览器 | 与变更前一致，不依赖 Electron |
| 2 | 目录结构 | 审查仓库 | Core/Web 仍在 `packages/core`、`packages/web`；壳为附加包 |
| 3 | Electron 就绪 | 启动 Electron 壳 | Core 未监听前不加载 SPA；就绪后可见 Studio |
| 4 | 退出清理 | 关闭 Electron | Core 子进程结束，端口可复用 |
| 5 | 能力探测 | 浏览器访问 | 无 `__OD_SHELL__` 或 `kind` 非 electron 时不崩溃 |
| 6 | 浏览器降级 | 外置浏览器选路径 | 仍走既有 pick-HTTP 或手输 |
| 7 | Electron 选路径 | 点击选可执行文件 | 系统对话框返回绝对路径；**可不**调 Core pick HTTP |
| 8 | 注册权威 | 提交注册 | 仍 `POST /v1/apps` 由 Core 校验与持久化 |
| 9 | monorepo | 仅开发 Core | 可不装 Electron 依赖即跑 Core 测试（Electron 可选） |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1.1–1.4 | Electron 壳骨架与生命周期 | spawn、就绪、退出杀进程 | — |
| 2.1–2.2 | preload 与 IPC | `__OD_SHELL__`、文件对话框 | 1 |
| 3.1–3.2 | Web 分支与测试 | 可选原生选路径 + 降级 | 2 |
| 4.1–4.2 | 文档与脚本 | 双基座说明、dev 脚本 | 1 |
| 5.1–5.2 | 回归 | core/web 测试 + 手动双路径 | 3 |

## 测试要点

- Vitest：模拟 `window.__OD_SHELL__` 与缺失两种分支。
- 手动：Node+浏览器全链路；Electron 选文件 + 提交注册。
- 回归：`packages/core`、`packages/web` 现有测试全绿。
