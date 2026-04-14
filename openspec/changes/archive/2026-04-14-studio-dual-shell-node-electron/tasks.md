## 1. Electron 壳包骨架

- 1.1 在 `packages/` 下新增壳目录（名称与 `design.md` 一致，如 `studio-electron-shell`），含 `package.json`（`electron` 依赖）、`main` 入口、`preload` 占位；根 workspace 可选纳入该包。
- 1.2 主进程实现 **spawn Core**（调用已构建的 `cli.js core start` 或文档化 `opd`），继承 env，解析 **端口**（与 Core 默认或 env 一致）。
- 1.3 实现 **等待 Core 就绪**（轮询 `GET /v1/version` 或等价）后再 `**loadURL`** 到 `http://127.0.0.1:<port>/`。
- 1.4 **退出时**向 Core 子进程发送终止信号并 `await` 清理，避免端口占用。

## 2. Preload 与能力探测

- 2.1 `contextBridge` 暴露 `**window.__OD_SHELL__`**：`kind: 'electron'`、`version`；**禁止**暴露 `require` 或任意 Node。
- 2.2 暴露 `**pickExecutableFile()`**（或等价名）：`ipcMain` 中 `**dialog.showOpenDialog**`，过滤可执行/应用包（平台相关），返回绝对路径或 `null`。

## 3. Web 差异化与降级

- 3.1 在注册/选择可执行文件流程中：若 `__OD_SHELL__?.kind === 'electron'`，**优先**调用 `pickExecutableFile()` 填表；否则保持现有 `**/v1/pick-executable-path`** 或手输路径。
- 3.2 确保无 `__OD_SHELL__` 时行为与变更前一致；补充轻量测试（Vitest：mock `window`）。

## 4. 文档与脚本

- 4.1 在 `docs/` 或 README 增加 **双基座**：Node 启动步骤、Electron 开发启动（`yarn workspace … electron .`）、生产打包说明（可选占位）。
- 4.2 `package.json` 根或壳包增加 `**electron:dev`** 脚本（若适用）。

## 5. 回归

- 5.1 `packages/core` `**yarn test**` 无回归；`packages/web` `**yarn test**` 通过。
- 5.2 手动验证：外置浏览器 + Core；Electron 窗内同一 Core 会话列表与注册流程。

