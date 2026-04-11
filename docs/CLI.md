# OpenDesktop CLI 手册（`od` / `yarn oc`）

> **依据**：CLI 行为以源码 `packages/core/src/cli.ts` 与终端输出 `od --help` 为最终依据；本文档随发版审阅，可能与旧版本有差异。

## 全局选项

在任意子命令前可传：

| 选项 | 说明 |
|------|------|
| `--api-url <url>` | Core HTTP 基址；默认取环境变量 `OPENDESKTOP_API_URL`，否则 `http://127.0.0.1:8787` |
| `--token-file <path>` | Bearer token 文件路径；默认取 `OPENDESKTOP_TOKEN_FILE` |
| `-h, --help` | 帮助 |

## 顶层命令一览

`od --help` 列出的 Commands（与实现对齐）：

| 命令 | 说明 |
|------|------|
| `core` | 守护进程：启动、状态、停止 |
| `app` | 已注册应用：列表、演示初始化、`create`、`remove` |
| `profile` | 启动配置（Profile）列表 |
| `session` | 会话：`list`、`start <profileId>`、`stop <id>` |
| `agent` | `POST /v1/agent/sessions/:id/actions` 封装 |
| `doctor` | 连通性自检 |
| `open` | 在系统默认浏览器打开 Core 基址下的路径 |

## `core`

| 子命令 | 说明 |
|--------|------|
| `core start` | 前台启动 Core；常用 `--port`、`--host`、`--data-dir`、`--web-dist`（静态 Web UI 目录） |
| `core status` | 根据 pid 文件判断是否在跑 |
| `core stop` | 向 pid 对应进程发 SIGTERM |

## `app`

| 子命令 | 说明 |
|--------|------|
| `app list` | `GET /v1/apps` |
| `app init-demo` | 一键注册内置 `demo-mock` 与 Profile `demo`（联调用） |
| `app create` | 注册应用并创建默认启动配置；必填 `--id`、`--exe`；可选 `--cwd`、`--args`（JSON 数组）、`--skip-debug-inject`、`--profile-id`、`--start` |
| `app remove --id <id>` | 删除已注册应用 |

## `profile`

| 子命令 | 说明 |
|--------|------|
| `profile list` | `GET /v1/profiles` |

## `session`

| 子命令 | 说明 |
|--------|------|
| `session list` | `-f table\|json` |
| `session start <profileId>` | 每次调用新建一条会话（`POST /v1/sessions`） |
| `session stop <id>` | 停止会话 |

## `agent`

| 子命令 | 说明 |
|--------|------|
| `agent action <sessionId>` | Body 来自 `--json` 或 stdin，请求 `POST /v1/agent/sessions/:id/actions` |

## `doctor`

检查 Core 是否可达、token 是否可读、Bearer 是否有效。可选 `-f table|json`、`--app <id>`（检查该应用是否有活跃会话）。

## `open`

`open --path /`：在默认浏览器打开 Core 基址（与 `--api-url` 一致）。

## App-first（不写 `sessionId`）

当第一个参数是**已注册应用 id** 且匹配 App-first 子命令时，CLI 会解析为该应用下**最新活跃会话**，无需手写 `sessionUuid`。工作区常用：

```bash
yarn oc <appId> list-window | metrics | snapshot | list-global | explore | network-observe | network-stream | console-observe | console-stream | stack-observe | stack-stream
yarn oc <appId> topology   # 与 list-window 等价
```

`yarn oc` 等价于 `yarn workspace @opendesktop/core cli`；全局安装时入口名为 `od`。

常用可选参数（与 `od --help` 文末一致）：

- `--format json` / `-f json`、`--session <uuid>`
- `list-global`：`--target`、`--interest`、`--max-keys`
- `explore`：`--max-candidates`、`--min-score`、`--include-anchor-buttons`
- `network-observe`：`--window-ms`、`--slow-ms`、`--no-strip-query`
- `network-stream`：`--no-strip-query`、`--max-events-per-second`（SSE；不适用 `--format`）
- `console-observe` / `stack-observe`：`--wait-ms`（短时 JSON）
- `console-stream` / `stack-stream`：SSE 长流（`stack` 需会话允许脚本执行）

对某 **已注册应用 ID**，默认选取该应用下 **最新一条活跃会话**（`running` / `starting` / `pending`）；若需指定会话，使用 **`--session <uuid>`**（须属于该应用）。

示例：

```bash
yarn od -- demo-mock list-window
yarn od -- demo-mock metrics
yarn od -- --format json demo-mock snapshot
yarn od -- --session <session-uuid> demo-mock list-window
```

## `--format` 与退出码

- **`--format` / `-f`**：`table`（默认）与 **`json`**（脚本友好，stdout 仅 JSON）。
- **常见退出码**（对齐 `sysexits` 子集）：**0** 成功；**2** 用法错误；**66** 无可用数据（如该应用无活跃会话）；**69** 服务不可用；**77** 鉴权失败；**78** 配置错误（如 token 文件不可用）。

## 相关环境变量（节选）

与 Agent / 观测相关（完整列表见 [API 与观测](./API.md) 及代码）：

- `OPENDESKTOP_AGENT_API` — 关闭 `/v1/agent/*`
- `OPENDESKTOP_EXTENDED_LOGS`、`OPENDESKTOP_AGENT_RPM`
- `OPENDESKTOP_RECIPES_DIR` — 操作配方目录

HTTP 端点、UserScript、SSE 与 Agent 动词表见 [docs/API.md](./API.md)。
