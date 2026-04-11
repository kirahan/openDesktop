# OpenDesktop

**语言：** [English](README.md) · **文档：** [CLI 手册](docs/CLI.md) · [HTTP 与观测 API](docs/API.md) · [产品能力规格](docs/PRODUCT.md)

本地 **Electron 调试会话控制面**：Core 提供 HTTP API、CDP 反向代理、JSON 持久化与可选 Web UI（`packages/web` 构建产物由 Core 静态托管）。

## 要求

- **Node.js ≥ 20.19**（需 `fetch`、较新 TypeScript 工具链）

## npm 安装（发行版）

若只需使用已发布的 CLI，可全局安装 `**@hanzhao111/opendesktop`**（与未 scoped 名称过近时需使用 scoped 包）：

```bash
npm install -g @hanzhao111/opendesktop
opd --help
opd core start --port 8787
```

全局命令为 `**opd**`。发行包若随包带有 `web-dist`，`opd core start` 会默认托管 Web 控制台；优先级见 **[docs/CLI.md](docs/CLI.md)**。本地验证方式见 `packages/opendesktop/README.md`。

参与本仓库开发或需要完整 monorepo 构建时，请使用下文「安装与构建」。

## 安装与构建（源码）

在仓库根目录 `openDesktop/`：

```bash
yarn install
yarn build
```

（亦可用 `npm install` / `npm run build`。）

## 启动 Core（前台）

```bash
yarn opd -- core start --port 8787
```

首次运行会在数据目录生成 `token.txt`（默认 macOS：`~/Library/Application Support/OpenDesktop/token.txt`）。启动时终端会**直接打印 `Token: …`**，复制到 Web UI 的 Bearer 字段即可。**请妥善保管**：持有 token 即相当于持有本机 Control API 权限。

**Web 静态目录**（可选）：解析顺序为 **`--web-dist` > `OPENDESKTOP_WEB_DIST` > 随包 `web-dist`**，详见 [docs/CLI.md](docs/CLI.md)。在 monorepo 里使用本仓库构建的 Web 时：

```bash
yarn opd -- core start --web-dist "$(pwd)/packages/web/dist"
```

浏览器打开 `http://127.0.0.1:8787/`，在页面中粘贴 `token.txt` 内容。或使用：

```bash
yarn opd -- open --path /
```

## 一键创建应用配置（推荐）

**先启动 Core**，并设置环境变量（路径按你本机改）：

```bash
export OPENDESKTOP_API_URL=http://127.0.0.1:8787
export OPENDESKTOP_TOKEN_FILE="$HOME/Library/Application Support/OpenDesktop/token.txt"
```

在仓库根目录执行：

```bash
yarn app:demo
```

会注册内置 **mock CDP** 应用 `demo-mock` 和对应启动配置（示例 id 为 `demo`）。

**一条命令**完成「应用 + 默认启动配置 + 会话」：

```bash
yarn demo
```

**短指令 `yarn oc`** = `yarn workspace @opendesktop/core cli`。

常用列表命令：

```bash
yarn oc app list
yarn oc profile list
yarn oc session list
yarn oc session start <profileId>
```

**推荐**：`yarn oc app create` 注册应用与默认启动配置，可加 `--start` 立即建会话（`app.id` 即「调用名」，与 App-first 下 `yarn oc <appId> <子命令>` 一致；同一 exe 多套配置请**多次注册**）：

```bash
yarn oc app create --id my-app --exe "$(which node)" --cwd "$PWD" --args '[]' --skip-debug-inject
# 需要立刻有会话时再加：--start
```

## 更多文档


| 文档                                 | 内容                           |
| ---------------------------------- | ---------------------------- |
| [docs/CLI.md](docs/CLI.md)         | 命令树、App-first、`doctor`、退出码   |
| [docs/API.md](docs/API.md)         | UserScript、HTTP 端点、Agent、SSE |
| [docs/PRODUCT.md](docs/PRODUCT.md) | OpenSpec 能力总览（SHALL）         |
| [docs/npm-publish.md](docs/npm-publish.md) | 维护者 npm 发布：测试、同步与 publish |


## CLI 快速示例

```bash
export OPENDESKTOP_API_URL=http://127.0.0.1:8787
export OPENDESKTOP_TOKEN_FILE=~/Library/Application\ Support/OpenDesktop/token.txt

yarn opd -- app list
yarn opd -- session list
yarn opd -- session list -f json
yarn opd -- doctor
yarn opd -- doctor -f json --app demo-mock
```

完整说明见 **[docs/CLI.md](docs/CLI.md)**。

## User Script 与安全概要

按应用持久化 UserScript、注入与 DOM 拾取等接口，以及 **Bearer / CDP / `allowScriptExecution`** 约束，见 **[docs/API.md](docs/API.md)**。

## Playwright `connectOverCDP`

详见 [docs/API.md](docs/API.md) 与 `GET /v1/sessions/:id` 响应。

## 开发环境如何启动

```bash
yarn install
yarn dev:core
```

需要同源托管已构建的 Web：`yarn build -w @opendesktop/web` 后 `yarn dev:core:ui`。前后端分开：终端 1 `yarn dev:core`，终端 2 `yarn dev:web`。

## 开发常用命令

```bash
yarn test -w @opendesktop/core
yarn test:watch -w @opendesktop/core
yarn lint -w @opendesktop/core
yarn docs:check-links
```

## 仓库结构

- `packages/core`：守护进程、HTTP API、CDP 代理、CLI（`opd`）
- `packages/web`：Vite + React；详见 [packages/web/README.md](packages/web/README.md)

