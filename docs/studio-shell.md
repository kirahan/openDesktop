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

包路径：`packages/studio-electron-shell`。实现细节见 **`packages/studio-electron-shell/src/main.js` 文件头注释**。

### 开发 vs 生产（与你的预期对齐）

| 维度 | **开发**（未打包 `app.isPackaged === false`） | **生产**（已打包 `app.isPackaged === true`） |
|------|-----------------------------------------------|---------------------------------------------|
| **Core 进程** | 默认 **`tsx` + `packages/core/src/cli.ts`（源码）**，**不是** `dist/cli.js`。 | **`packages/core/dist/cli.js`**（及包内资源布局）。 |
| **Electron 里的 Web** | 默认 **Vite 开发服** `http://127.0.0.1:5173/`（壳自动 `yarn dev:web` 或复用已启动），**不是** `packages/web/dist`。`/v1` 由 Vite 代理到 Core。 | 默认 **`http://127.0.0.1:<Core 端口>/`**，由 **Core 托管已构建的静态 Web**（`web/dist` 随分发），**不**启动 Vite。 |

**开发态补充**：若本机已存在 `packages/web/dist/index.html`，Core 的 `core start` **可能仍带 `--web-dist`**，这样外置浏览器可直接打开 `http://127.0.0.1:8787/` 访问构建产物；**Electron 窗口在默认配置下仍走 Vite**，二者不矛盾。

主进程会 **spawn** Core 的 **`core start`**（若本机已有 Core 在监听同一端口则复用，不重复启动），再按上表加载窗口 URL。

- **开发（未打包，默认）**：壳在仓库根 **自动执行 `yarn dev:web`**（若 5173 已有服务则跳过），再加载 **`http://127.0.0.1:5173/`**。一般只需 **`yarn electron:dev` 一个终端**；退出 Electron 时会尝试结束由壳启动的 Vite 子进程。
- **开发（窗口改走 Core 托管的 `web/dist`）**：设置 **`OPENDESKTOP_STUDIO_USE_CORE_UI=1`**，并先 **`yarn workspace @opendesktop/web run build`**，窗口将加载 `http://127.0.0.1:<Core 端口>/`。
- **自定义窗口 URL**：设置 **`OPENDESKTOP_STUDIO_URL`**（例如 Vite 改端口时 `http://127.0.0.1:5174/`）。

### Core 启动方式（壳内分支，不改 Core 业务代码）

| 场景 | 行为 |
|------|------|
| **开发**（默认，`app.isPackaged === false`） | `node --import tsx packages/core/src/cli.ts core start …`，**无需先** `yarn workspace @opendesktop/core run build`。 |
| **强制用构建产物** | 设置 **`OPENDESKTOP_ELECTRON_USE_CORE_DIST=1`**，则使用 **`packages/core/dist/cli.js`**（与生产验证、CI 对齐）。 |
| **打包后的 .app**（`app.isPackaged === true`） | 使用 **`dist/cli.js`**（由后续 electron-builder 等资源布局提供路径；当前仍以 monorepo 内路径解析）。 |

### Web 与前置

- 默认开发流：只跑 **`yarn electron:dev`**，壳会 spawn Core（源码）+（若需要）`yarn dev:web`。
- 若已手动开启 Vite，壳检测到端口可用则不再重复启动。
- **`OPENDESKTOP_ELECTRON_SKIP_VITE_SPAWN=1`**：不自动起 Vite，请自行先 `yarn dev:web`（用于想完全手控进程时）。
- 若希望 Core 子进程带 **`--web-dist`**（例如同时用浏览器打开 `http://127.0.0.1:8787/`），可先构建 Web。

开发启动示例（在仓库根目录，**可不 build Core / Web**）：

```bash
yarn install
yarn electron:dev
```

若安装时 **Electron 二进制下载失败**（网络限制），可临时设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 yarn install` 完成其余依赖，再在可访问 GitHub 的环境下单独执行 `node node_modules/electron/install.js` 或重新 `yarn install` 以下载 Electron。

根目录脚本 **`yarn electron:dev`** 等价于 `yarn workspace @opendesktop/studio-electron-shell run electron:dev`。

在 Electron 内，「选择可执行文件」**优先**使用 **Electron 原生** `dialog.showOpenDialog`（不经由 Core 的 pick-executable HTTP）；提交注册仍走 **`POST /v1/apps`**。

### Qt 会话：屏幕十字线 + AX「指针附近」树（仅 macOS）

Electron **preload** 可选暴露：

- `startQtAxOverlay()` / `stopQtAxOverlay()`：主进程创建**全屏透明** `BrowserWindow`（初始覆盖**指针所在显示器**，轮询中随 `screen.getDisplayNearestPoint` 移动/缩放以支持多显示器）；macOS 上 `setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces` 尽量保证十字线叠在 Qt 之上；`setIgnoreMouseEvents(true, { forward: true })` 使点击穿透至下层 Qt；主进程以约 **100ms** 轮询 `screen.getCursorScreenPoint()`，向 Studio 渲染进程发送 **`od:qt-ax-cursor`**（屏幕像素坐标，与 **`GET /v1/sessions/:id/native-accessibility-at-point?x=&y=`** 同源）。
- `subscribeQtAxCursor(cb)`：订阅上述坐标（返回取消函数）。

覆盖层页面仅绘制**十字线 + 圆点**，**不**绘制控件矩形（与 OpenSpec `studio-qt-ax-cursor-overlay` 一致）。外置浏览器无此 API，Studio 仍走 nut-js 轮询路径。

## 3. 生产打包（占位）

使用 `electron-builder` 将 Core **`dist`**、Web **`dist`** 与壳一并打包、签名等，可在后续变更中补充。打包后 **`app.isPackaged === true`**：Electron 加载 **Core 提供的 HTTP 根路径**上的静态 Web，**不再**内嵌 Vite 开发服（见上文「开发 vs 生产」表）。
