## Why

OpenDesktop Studio 目前以 **Node 启动 Core + 浏览器打开 Web** 为主路径；随着 Qt 观测、后续 overlay、快捷键等需求出现，**桌面级基座**（Electron）能在**不复制业务逻辑**的前提下提供系统弹窗、多窗口、全局快捷键等增强能力。需要在**不大改仓库顶层结构**的前提下，正式支持 **两种分发/启动形态**：既有 **Node 基座**，与可选的 **Electron 基座**，并允许 Electron 在少数交互上走**差异化实现**（仍以同一 Core HTTP 与同一 Web 构建为真源）。

## What Changes

- 新增 **Electron 薄壳包**（建议置于 `packages/` 下独立目录，如 `studio-electron-shell`），**主进程**负责：按需 **spawn 既有 Core 进程**（复用现有 CLI/`core start` 行为）、等待 HTTP 就绪、**BrowserWindow** 加载与现有 **Web SPA** 相同的 URL 或 `file://` 静态入口。
- **不**复制 `packages/core` 与 `packages/web` 的业务代码；差异化能力通过 **preload 暴露窄接口**（如 `openExecutableDialog`）与 **特性探测**（`shell.kind === 'electron'`）在 Web 层做可选分支。
- **Node 基座**行为保持：**用户或脚本**启动 Core，浏览器访问 Core 根路径；文档与脚本路径明确为「默认/开发者路径」。
- 文档与 `package.json` workspace（若适用）中声明 **两种安装/启动方式**；CI **MAY** 仅对 Electron 壳增加轻量构建任务。
- 可选增强（首版可交付一项即可）：Electron 下 **注册应用**时 **原生文件选择** 获取可执行路径，**无需**调用 Core 的「辅助选路径」HTTP；浏览器基座 **MUST** 保留现有降级路径（如 Core `pick-executable` 或表单手输）。

## Capabilities

### New Capabilities

- `studio-shell-host`: 定义双基座（Node + Electron）的职责边界、Shell 能力探测、与 Core/Web 的契约；Electron 增强能力（原生选文件等）的 **SHALL/MUST** 与 **降级** 行为。

### Modified Capabilities

- （无）本变更以 **新增能力规格** 为主；与 `opd-bundled-web-default` 的衔接通过 design 中「Electron 设置 `OPENDESKTOP_WEB_DIST` / `--web-dist`」约定实现，**不**修改该 spec 的既有 Requirement 条文（避免 archive 合并冲突）；若后续需把「Electron 注入环境」上升为规范级要求，可再单开 delta。

## Impact

- **新增** `packages/` 下 Electron 壳目录、`package.json` / workspace、可能的 `electron-builder` 配置（可选）。
- **packages/web**：小范围增加 **shell 特性探测**与可选 IPC 调用（preload 契约）；核心页面逻辑不变。
- **packages/core**：原则上 **无行为变更**；Electron 仅作为 **启动 Core 的进程管理方**。若已有 `pick-executable` 等接口，在 Electron 路径下 **MAY** 减少调用频率，但 **MUST** 保留供浏览器基座使用。
- **文档**：`docs/` 或 `project-documentation` 指向的入门路径需补充「双基座」说明。