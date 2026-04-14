# Studio 双基座：Node + 浏览器 与 Electron

OpenDesktop Studio（`packages/web` 构建的 SPA）有两种启动方式，**共用同一 Core HTTP API**，仅「宿主」不同。

## 1. Node 基座（默认 / 开发）

1. 构建 Core 与 Web：`yarn build`（或分别 `yarn workspace @opendesktop/core run build`、`yarn workspace @opendesktop/web run build`）。
2. 启动 Core 并托管 Web：
   ```bash
   yarn opd -- core start --port 8787 --web-dist "$(pwd)/packages/web/dist"
   ```
3. 用**外置浏览器**打开 `http://127.0.0.1:8787/`，将终端打印的 Token 粘贴到 Bearer。

注册应用时「选择可执行文件」走 Core 的 **`POST /v1/pick-executable-path`**（macOS 由 Core 调起系统对话框）。

## 2. Electron 基座（可选）

包路径：`packages/studio-electron-shell`。主进程会 **spawn** Core 的 **`core start`**（若本机已有 Core 在监听同一端口则复用，不重复启动），再用 **BrowserWindow** 加载 `http://127.0.0.1:<port>/`。

### Core 启动方式（壳内分支，不改 Core 业务代码）

| 场景 | 行为 |
|------|------|
| **开发**（默认，`app.isPackaged === false`） | `node --import tsx packages/core/src/cli.ts core start …`，**无需先** `yarn workspace @opendesktop/core run build`。 |
| **强制用构建产物** | 设置环境变量 **`OPENDESKTOP_ELECTRON_USE_CORE_DIST=1`**，则使用 **`packages/core/dist/cli.js`**（与生产验证、CI 对齐）。 |
| **打包后的 .app**（`app.isPackaged === true`） | 仅使用 **dist** 布局（由后续打包配置提供路径；当前仍以 monorepo 内路径解析）。 |

### Web 与前置

- 若存在 **`packages/web/dist/index.html`**（或 **`OPENDESKTOP_WEB_DIST`**），Core 会带 **`--web-dist`**，窗口内为完整 SPA。
- 未构建 Web 时 Core 可能仅提供 API，根路径未必有界面；开发 Web 时仍可 **外置浏览器 + Vite**（`yarn dev:web` 等），与 Electron 窗口二选一或并行。

开发启动示例（在仓库根目录，**可不 build Core**）：

```bash
yarn install
yarn workspace @opendesktop/web run build   # 需要壳内完整 Web 时再执行
yarn electron:dev
```

若安装时 **Electron 二进制下载失败**（网络限制），可临时设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 yarn install` 完成其余依赖，再在可访问 GitHub 的环境下单独执行 `node node_modules/electron/install.js` 或重新 `yarn install` 以下载 Electron。

根目录脚本 **`yarn electron:dev`** 等价于 `yarn workspace @opendesktop/studio-electron-shell run electron:dev`。

在 Electron 内，「选择可执行文件」**优先**使用 **Electron 原生** `dialog.showOpenDialog`（不经由 Core 的 pick-executable HTTP）；提交注册仍走 **`POST /v1/apps`**。

## 3. 生产打包（占位）

使用 `electron-builder` 将 Core 构建物、`web-dist` 与壳一并打包、签名等，可在后续变更中补充；当前以 monorepo 内开发运行为主。
