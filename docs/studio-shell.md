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

### Qt 会话：屏幕十字线 +「指针附近」无障碍树

**macOS**：使用系统 **Accessibility（AX）**；详见下节 Electron 十字线与 `native-accessibility-at-point` 坐标约定。

**Windows**：Core 通过 **PowerShell 调用 .NET UI Automation**（`native-windows/uia-at-point.ps1` 按点、`uia-full-tree.ps1` 整树）在屏幕坐标处命中或枚举顶层窗口子树，并校验 **`ProcessId` 与会话 `pid` 一致**（按点路径下指针命中其它进程则 **`HIT_OUTSIDE_SESSION`**）。未传 `x`/`y` 时 Core 用 **GetCursorPos**（PowerShell 内嵌）读取指针。坐标为 **屏幕像素**；多显示器与 DPI 下请与 Electron **`screen.getCursorScreenPoint`** 或显式查询参数保持一致。**`native_accessibility_tree`** 与 **`native_accessibility_at_point`** 是否在 Windows 可用以 **`GET /v1/version` → `capabilities`** 为准。

### Qt 会话：Electron 十字线与 AX 指针（macOS 细节）

Electron **preload** 可选暴露：

- `startQtAxOverlay()` / `stopQtAxOverlay()`：主进程创建**全屏透明** `BrowserWindow`（初始覆盖**指针所在显示器**，轮询中随 `screen.getDisplayNearestPoint` 移动/缩放以支持多显示器）；macOS 上 `setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces` 尽量保证十字线叠在 Qt 之上；`setIgnoreMouseEvents(true, { forward: true })` 使点击穿透至下层 Qt；主进程以约 **100ms** 轮询 `screen.getCursorScreenPoint()`，向 Studio 渲染进程发送 **`od:qt-ax-cursor`**（屏幕像素坐标，与 **`GET /v1/sessions/:id/native-accessibility-at-point?x=&y=`** 同源）。
- `subscribeQtAxCursor(cb)`：订阅上述坐标（返回取消函数）。

覆盖层页面仅绘制**十字线 + 圆点**，**不**绘制控件矩形（与 OpenSpec `studio-qt-ax-cursor-overlay` 一致）。外置浏览器无此 API，Studio 仍走 nut-js 轮询路径。

### 全局快捷键（矢量录制 / 打点，仅 Electron）

**Node 基座 + 外置浏览器无此能力**（不展示配置 UI）。Electron 主进程使用 `globalShortcut` 注册**系统级**快捷键；按下后由**主进程**使用与 Core 一致的 **Bearer**（`token.txt`）直接请求 **`POST /v1/sessions/:sessionId/control/global-shortcut`**，**业务在 Core 内执行**，不依赖 Studio Web 是否已打开。**会话作用域**：若 Web 未通过 **`setStudioSessionContext`** 固定会话，主进程会 **`GET /v1/sessions`**，对全部 **`state === running`** 的会话依次调用控制面（`vector-record-toggle` 对每个 running 会话各执行一次；多会话时 **segment/checkpoint** 仅作用于列表中的**第一个** running 会话，避免歧义）。可选：在 Studio 打开会话详情 / 矢量 Tab 时同步 `sessionId`、`targetId` 以收窄作用域或指定打点 target。

| 能力 | preload / IPC |
|------|----------------|
| 应用绑定 | `setGlobalShortcutBindings(bindings)` → `invoke("od:set-global-shortcuts", bindings)`；`bindings` 为 `{ [actionId: string]: accelerator }`，空字符串表示不绑定。 |
| 快捷键上下文 | `setStudioSessionContext({ sessionId, targetId? })` → `invoke("od:set-studio-session-context")`；矢量 Tab 选中时带 `targetId`，供 segment/checkpoint；仅会话详情时可为 `targetId: null`。 |

动作 ID：`vector-record-toggle`、`segment-start`、`segment-end`、`checkpoint`。配置持久化在浏览器 **`localStorage`**（`od_global_shortcut_bindings_v1`），启动时自动同步主进程。

**控制面 API（第三方客户端可同样调用）**：`POST /v1/sessions/:sessionId/control/global-shortcut`，`Authorization: Bearer`，JSON body `{ "actionId": "<闭集>" }`；可选 `targetIds`（矢量批量）、`targetId`（打点单 target）。`vector-record-toggle` 在未传 `targetIds` 时由 Core 拉取 CDP 拓扑中 **`type === "page"`** 的全部 target 并批量 start/stop。

**排障（组合键「保存并注册」失败或不触发）：**

- **Accelerator 格式**：须为 Electron 可解析字符串，用**半角** `+` 连接修饰键与主键，避免多空格或全角 `＋`（主进程会做 NFKC/别名规范化，但无法修复所有输入错误）。
- **已被占用**：若组合键已被系统或其他应用占用，`globalShortcut.register` 会失败且无系统提示；请更换组合键。
- **重复绑定**：同一组合键不可绑定两个动作；界面会提示 `DUPLICATE_ACCELERATOR`。
- **Linux Wayland**：壳在检测到 `XDG_SESSION_TYPE=wayland` 时会追加 `enable-features=GlobalShortcutsPortal`（与 Electron 文档一致）。
- **macOS 键盘布局**：Electron 对非 QWERTY 布局的全局快捷键存在长期限制（上游 issue），若异常可尝试 QWERTY 或换用其他组合键。

打点时 Web 请求 Core：**`POST /v1/sessions/:sessionId/replay/recording/ui-marker`**，body `{ targetId, cmd: "segment_start" | "segment_end" | "checkpoint" }`（须已有活跃矢量录制）。

### 多 target 并行录制与合并时间线（session-replay-multi-target）

- **同一会话**下可对**多个 `targetId`** 同时开启矢量录制（有并发上限；第二个 target 启动失败时返回 **409** `PARALLEL_LIMIT_EXCEEDED`）。
- 矢量 NDJSON 行会携带 **`targetId`、`seq`、`monoTs`、`mergeTs`**（及 `sessionId`），用于多轨合并排序；**不要**仅靠窗口焦点推断归属。
- **合并序**：按 `(mergeTs, targetId, seq)` 全序（详见 Core `replayTimelineMerge`）。
- **会话标记（入点/出点/检查点，MVP）**：`POST /v1/sessions/:sessionId/replay/markers`，body 含 `mergedTs`、`scope`（`session` | `target`）；`scope=target` 时 **必须**带 `targetId`。`GET` 同路径返回当前进程内已排队列。
- **全局快捷键矢量开/关**：由 Core 对会话内 **CDP page 型 target**（或请求体显式 `targetIds`）批量 start/stop；**打点**使用 Web 同步到主进程的 `targetId`（矢量 Tab 选中时），多 page 且无 `targetId` 时 Core 返回可机读错误。

## 3. 生产打包（占位）

使用 `electron-builder` 将 Core **`dist`**、Web **`dist`** 与壳一并打包、签名等，可在后续变更中补充。打包后 **`app.isPackaged === true`**：Electron 加载 **Core 提供的 HTTP 根路径**上的静态 Web，**不再**内嵌 Vite 开发服（见上文「开发 vs 生产」表）。
