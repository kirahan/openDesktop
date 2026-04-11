# OpenDesktop

本地 **Electron 调试会话控制面**：Core 提供 HTTP API、CDP 反向代理、JSON 持久化与可选 Web UI（`packages/web` 构建产物由 Core 静态托管）。

## 要求

- **Node.js ≥ 20.19**（需 `fetch`、较新 TypeScript 工具链）

## 安装与构建

```bash
cd openDesktop
npm install
npm run build
```

## 启动 Core（前台）

```bash
npm run od -- core start --port 8787
```

首次运行会在数据目录生成 `token.txt`（默认 macOS：`~/Library/Application Support/OpenDesktop/token.txt`）。启动时终端会**直接打印 `Token: …`**，复制到 Web UI 的 Bearer 字段即可。**请妥善保管**：持有 token 即相当于持有本机 Control API 权限。

带 Web UI（同源）：

```bash
npm run od -- core start --web-dist "$(pwd)/packages/web/dist"
```

浏览器打开 `http://127.0.0.1:8787/`，在页面中粘贴 `token.txt` 内容。

或使用：

```bash
npm run od -- open --path /
```

## 一键创建应用配置（推荐）

**先启动 Core**，并设置环境变量（路径按你本机改）：

```bash
export OPENDESKTOP_API_URL=http://127.0.0.1:8787
export OPENDESKTOP_TOKEN_FILE="$HOME/Library/Application Support/OpenDesktop/token.txt"
```

在 `**openDesktop/**` 目录执行（**无需先 build**，走 tsx）：

```bash
yarn app:demo
```

会注册内置 **mock CDP** 应用 `demo-mock` 和对应启动配置（示例 id 为 `demo`）。

**一条命令**完成「应用 + 默认启动配置 + 会话」：

```bash
yarn demo
```

（在仓库根目录 `opensource/` 也可：`yarn demo`，会转发到 `openDesktop`。）

**短指令 `yarn oc`** = `yarn workspace @opendesktop/core cli`（在 `opensource/` 根目录同样可用）。

查看列表：

```bash
yarn oc app list
yarn oc profile list   # 启动配置列表，对应 GET /v1/profiles
yarn oc session list
yarn oc session start <profileId>   # 新建调试会话；每次调用均 POST /v1/sessions，得到新 session id
```

**推荐：`app create` 一条命令**注册应用、默认启动配置，并可选用 `--start` 立即建会话（`app.id` 即「调用名」，与 App-first 下 `yarn oc <appId> <子命令>` 一致；同一 exe 多套配置请**多次注册**，各用不同 id）：

```bash
yarn oc app create --id my-app --exe "$(which node)" --cwd "$PWD" --args '[]' --skip-debug-inject
# 需要立刻有会话时再加：--start
```

## CLI 示例

```bash
export OPENDESKTOP_API_URL=http://127.0.0.1:8787
export OPENDESKTOP_TOKEN_FILE=~/Library/Application\ Support/OpenDesktop/token.txt

yarn od -- app list
yarn od -- session list
yarn od -- session list -f json
```

### App 优先（弱化 session 心智）

对某 **已注册应用 ID**，默认选取该应用下 **最新一条活跃会话**（`running` / `starting` / `pending`），无需手写 `sessionId`；若需指定会话，加 **`--session <uuid>`**（须属于该应用）。

```bash
yarn od -- demo-mock list-window
yarn od -- demo-mock metrics
yarn od -- demo-mock snapshot
yarn od -- --format json demo-mock snapshot
yarn od -- --session <session-uuid> demo-mock list-window
```

（`topology` 仍为子命令别名，与 `list-window` 等价。）

### `od doctor`（连通性自检）

检查 Core 是否可达、`token` 是否可读、Bearer 是否有效；可选 **`--app <id>`** 查看该应用是否存在活跃会话。

```bash
yarn od -- doctor
yarn od -- doctor -f json
yarn od -- doctor --app demo-mock
```

### `--format` 与退出码

- 支持 **`--format` / `-f`**：`table`（默认）与 **`json`**（脚本/管道友好，stdout 仅 JSON）。
- 常见退出码（对齐 `sysexits` 子集）：**0** 成功；**2** 用法错误；**66** 无可用数据（如该应用无活跃会话）；**69** 服务不可用（Core 不可达等）；**77** 鉴权失败；**78** 配置错误（如 token 文件不可用）。

更底层的 HTTP 示例见源码测试与下方 Playwright 说明。

### 按应用用户脚本（UserScript 元数据存储）

将油猴风格 **`// ==UserScript==` … `// ==/UserScript==`** 块写入 Core，按 **`appId`** 归属持久化（文件：`<dataDir>/user-scripts.json`）。解析后的 **`metadata.matches`** 为 **`@match` 原文列表**。**`@match` 不参与是否注入、注入到哪些 CDP target 的决策**（避免与 SPA 客户端路由语义混淆；规格见 `openspec/specs/app-user-scripts/spec.md`）。**不会在后台自动执行脚本**：需在会话 **`running`** 且允许脚本执行时，**显式调用**下方「注入」接口，将当前 app 下全部脚本 **正文** 注入到 **当时 CDP 枚举到的全部 `page` 类型 target**（同一脚本可能在多个 frame target 上各执行一次）。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/v1/apps/:appId/user-scripts` | Body：`{ "source": "<完整 .user.js 文本>" }`；成功 **201**，响应含 `script.metadata.matches` |
| `GET` | `/v1/apps/:appId/user-scripts` | 列出该 app 下脚本 |
| `GET` | `/v1/apps/:appId/user-scripts/:scriptId` | 单条 |
| `PATCH` | `/v1/apps/:appId/user-scripts/:scriptId` | Body：`{ "source": "..." }` |
| `DELETE` | `/v1/apps/:appId/user-scripts/:scriptId` | 成功 **204** |
| `POST` | `/v1/sessions/:sessionId/user-scripts/inject` | **显式注入**（Bearer）：将该会话 Profile 所属 `appId` 下全部脚本正文注入全部 `page` target；需 **`allowScriptExecution: true`**；响应含 `injectedScripts`、`targets`、`errors[]` |
| `POST` | `/v1/sessions/:sessionId/targets/:targetId/dom-pick/arm` | **DOM 拾取（spike）**：向目标 `page` 注入 `pointerdown` 监听，将坐标写入 `window.__odDomPickLast`；需 **`allowScriptExecution: true`** |
| `POST` | `/v1/sessions/:sessionId/targets/:targetId/dom-pick/resolve` | **DOM 拾取**：读取并清空上述坐标，用 **`DOM.getNodeForLocation` + `DOM.describeNode`** 返回 `pick` + `node`；无记录时 **400** `DOM_PICK_EMPTY` |

**DOM 拾取（spike）流程**：先 **`dom-pick/arm`** → 在**被测应用窗口**内对页面 **`pointerdown`**（与常见「点击」一致）→ 再 **`dom-pick/resolve`** 取节点摘要。仅面向 **单一 `page` target`**；**无**操作系统级全局鼠标钩子。行为见 `openspec/specs/cdp-dom-pick/spec.md`。

**`@grant`** 仅允许 **`none`**（或可省略）；否则返回 **`USER_SCRIPT_GRANT_NOT_SUPPORTED`**。缺少 **`@name`** 返回 **`USER_SCRIPT_VALIDATION_ERROR`**。均需 **Bearer**。

## 安全说明

- Core **默认只监听 127.0.0.1**，请勿在未配置防火墙时绑定 `0.0.0.0`。
- `/v1/sessions/:id/cdp/`* 为调试流量，**不强制 Bearer**，以便 DevTools / CDP 客户端；依赖 **仅本机回环** 与上游会话隔离。
- **CDP 等效高权限**：可执行页面脚本与访问调试协议，勿向公网暴露。
- `**/v1/agent/*`** 与语义动作受 Bearer + **限流**约束；会改导航、执行脚本或模拟输入的动作（如 `open`、`eval`、`click`、`type`、`back`、`close`、`renderer-globals`、`runtime-exception`、**`POST .../user-scripts/inject`**、**`POST .../dom-pick/arm`**、**`POST .../dom-pick/resolve`** 等）需会话侧 **`allowScriptExecution: true`**（**`POST /v1/profiles` 新建 Profile 时默认 `true`**；旧数据或未迁移会话仍可能为 `false`，可显式传 `allowScriptExecution: false` 关闭）。只读类（如 `state`、`get`、`explore`、`screenshot`、`network`、`network-observe`、`console-messages`、`window-state`）以及仅 `ms`、不含 `selector` 的 `wait`、以及窗口前置 `focus-window` 不需要。

## 语义层与可观测 API（Bearer）

会话 `running` 且 CDP 可用时：


| 端点                                                          | 说明                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/sessions/:id/list-window`                            | 窗口/调试目标列表（归一化 CDP `/json/list`）；`/topology` 为兼容别名                                                                 |
| `GET /v1/sessions/:id/metrics`                              | 子进程 CPU/内存；不可得时 `metrics: null` + `reason`                                                                               |
| `GET /v1/sessions/:id/console/stream?targetId=<id>`        | **SSE**（`text/event-stream`）：订阅后持续推送 `Runtime.consoleAPICalled`（仅连接建立后的新日志，无历史）。需 Bearer；会话非 `running` 或无 CDP 时 **503**；全局并发路数有上限时 **429**。与下方 Agent `console-messages` **短时采样**互补，**不含 Network 监听**。 |
| `GET /v1/sessions/:id/network/stream?targetId=<id>`       | **SSE**：每条请求完成（`loadingFinished`/`loadingFailed`）推送元数据 JSON（**无 body**）。可选 `stripQuery`（默认 true）、`maxEventsPerSecond`（默认 40，上限 200）；超速率时丢弃并 `event: warning`（`NETWORK_SSE_RATE_LIMIT`）。与 `network-observe` **窗口聚合**互补。并发上限 **429**。 |
| `GET /v1/sessions/:id/proxy/stream`                         | **SSE**：**本地转发代理**观测（`proxyRequestComplete`）。仅当对应已注册应用开启 **专用代理** 且本会话已拉起代理时可用，否则 **503**（`LOCAL_PROXY_NOT_ACTIVE`）。首期 **HTTPS 为 CONNECT 隧道不解密**（事件含 `tlsTunnel: true`）；与 CDP `network/stream` **并存**。 |
| `GET /v1/sessions/:id/runtime-exception/stream?targetId=<id>` | **SSE**：持续推送 `Runtime.exceptionThrown` 解析结果（与短时 `runtime-exception` action 字段对齐）。**须** `allowScriptExecution: true`，否则 **403**。每分钟推送上限，超限丢弃并 `event: warning`。并发上限 **429**。 |
| `GET /v1/sessions/:id/logs/export?format=jsonl&level=error` | 服务端过滤后导出（`format=txt` 亦可）                                                                                                |
| `GET /v1/agent/sessions/:id/snapshot`                       | OODA 结构化快照（拓扑摘要、错误计数、指标等）                                                                                                |
| `POST /v1/agent/sessions/:id/actions`                       | JSON：`action` 使用与 **OpenCLI `operate`** 同一套动词标识（见下表）。`GET /v1/version` 的 `agentActions` 列出当前接受的 canonical 名与历史别名。 |
| `GET /v1/agent/sessions/:id/recipes?app=<slug>`              | 列出已保存的操作配方（`app` 可选，仅扫描该应用子目录） |
| `GET /v1/agent/sessions/:id/recipes/:appSlug/:recipeId`      | 读取单份配方 JSON（`recipeId` 不含 `.json` 后缀） |
| `POST /v1/agent/sessions/:id/recipes/:appSlug/:recipeId/run` | 执行配方：`{ "targetId": "...", "verifiedBuild": "可选" }`。需 **`allowScriptExecution: true`**（与 `click` 相同）。成功后**原子写回**更新后的 `selector` / `updatedAt`（及可选 `verifiedBuild`） |

`curl -N` 消费网络观测 SSE 示例（需替换 `TOKEN`、`SESSION`、`TARGET`）：

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8787/v1/sessions/$SESSION/network/stream?targetId=$TARGET"
```

`GET /v1/version` 的 `capabilities` 数组可用来探测是否启用 Agent 等；**`sseObservabilityStreams`** / **`sseObservabilityStreamPaths`** 列出网络、运行时异常与 **本地代理** 等观测 SSE 的可发现名与路径模板。

**本地转发代理与目标应用**：已注册应用开启 **专用代理** 时，启动流程会注入 `HTTP_PROXY`/`HTTPS_PROXY`。若目标为 **自带独立代理配置的 Electron 等应用**，其可能 **不采用** 上述环境变量，导致 **`proxy/stream` 无事件**。可改用 **系统全局代理** 指向同一 loopback 端口，或在 **应用内** 将代理设为与本机转发代理一致（详见 `packages/web/README.md`「本地转发代理」）。

**操作配方目录**：默认 `<数据目录>/recipes/`，可按应用分子目录存放，例如 `recipes/<appSlug>/<recipeId>.json`。覆盖目录：`OPENDESKTOP_RECIPES_DIR`。配方 `schemaVersion: 1`，步骤目前仅支持 `action: "click"`；若首次 `click` 失败，可在步骤上配置 `match`（如 `labelContains`）以触发 **DOM 探索兜底**（与 `explore` 同源解析），唯一匹配后重试并写回新 `selector`。

**Agent 动词表（与 OpenCLI README 对齐，含实现状态）**

| `action` | 说明 | 主要请求字段 | 实现状态 |
|----------|------|----------------|----------|
| `open` | 导航到 `url` 并等待加载 | `targetId`, `url` | 已实现（需 `allowScriptExecution`） |
| `state` | 窗口/目标拓扑快照（同 list-window 数据形态） | `targetId` 不需要 | 已实现 |
| `click` | 在 `selector` 中心近似点击 | `targetId`, `selector` | 已实现（需脚本） |
| `type` | 聚焦元素并插入文本 | `targetId`, `selector`, `text` | 已实现（需脚本） |
| `select` | 设置 `<select>` 值并触发 `change` | `targetId`, `selector`, `value` | 已实现（需脚本） |
| `keys` | 派发按键（`key` 为常用名或单字符） | `targetId`, `key` | 已实现（需脚本） |
| `wait` | 延时 `ms` 和/或等待 `selector` 出现 | `targetId`, `ms` / `selector`, 可选 `timeoutMs` | 已实现（含 `selector` 时需脚本） |
| `get` | 整页 `outerHTML`（可能截断） | `targetId` | 已实现 |
| `explore` | 与 `get` **同源**拉取 HTML，在 Core 内**只读解析**（cheerio），返回按钮类候选列表（`label`、`selector`、`score`、`reasons`）；`selector` 与 `click` 一致；可选 `maxCandidates`（默认 32）、`minScore`（0～1）、`includeAnchorButtons` | `targetId` | 已实现（纯只读，不需 `allowScriptExecution`） |
| `screenshot` | PNG Base64 | `targetId` | 已实现 |
| `scroll` | `selector` 滚入视窗，或 `deltaX`/`deltaY` | `targetId`, 可选 `selector` / `deltaX` / `deltaY` | 已实现（需脚本） |
| `back` | 历史后退并等待加载 | `targetId` | 已实现（需脚本） |
| `eval` | `Runtime.evaluate` | `targetId`, `expression` | 已实现（需脚本） |
| `network` | 只读 Cookie（`Network.getCookies`） | `targetId`, 可选 `urls` 数组 | 已实现 |
| `network-observe` | 短时窗口内 CDP `Network` 聚合：发起数、完成数、`maxConcurrent`、慢请求列表等；**不含** request/response body（MVP） | `targetId`；可选 `windowMs`（100～30000，默认 3000）、`slowThresholdMs`（默认 1000）、`maxSlowRequests`（1～100，默认 20）、`stripQuery`（默认 true，去掉 query/hash） | 已实现（**不需** `allowScriptExecution`） |
| `init` | 对齐 OpenCLI 的初始化语义 | 无额外必填 | 已实现（Core 侧 no-op 说明） |
| `verify` | 表达式求值须为 truthy | `targetId`, `expression` | 已实现（需脚本） |
| `close` | `Target.closeTarget` 关闭调试目标 | `targetId` | 已实现（需脚本） |
| `window-state` | 宿主窗口尺寸/位置、`windowState`；若 Profile 允许脚本则附带 `document.visibilityState` 与 `document.hasFocus` | `targetId` | 已实现（扩展） |
| `focus-window` | `Page.bringToFront`，尝试激活该 target 所在窗口 | `targetId` | 已实现（扩展） |
| `renderer-globals` | CDP `Runtime.evaluate` 反射枚举 `globalThis` 属性（`typeof`、可选 interest 正则匹配名）；**非**跨进程持有 live `window` | `targetId`，可选 `interestPattern`、`maxKeys`（默认条数上限见 Core） | 已实现（需脚本） |
| `console-messages` | 短时采样控制台 | `targetId`, 可选 `waitMs` | 已实现（OpenDesktop 扩展，非 OpenCLI 表内） |
| `runtime-exception` | 短时订阅 `Runtime.exceptionThrown`，返回首条未捕获异常的文案与结构化栈帧（`frames`）；**无历史回溯**，与 `console-messages` 同为增量观测 | `targetId`，可选 `waitMs`（默认 2000，上限 30s） | 已实现（需 `allowScriptExecution`；OpenDesktop 扩展） |

`console-messages` 面向 **`Runtime.consoleAPICalled`** 字符串日志；**`runtime-exception`** 面向 **未捕获异常** 与 **`exceptionDetails.stackTrace`**。二者均只在监听窗口内收**新事件**，不能像服务端日志那样回溯过去。

Studio 中「实时控制台」使用 **`GET .../console/stream`**（`fetch` + SSE 解析，可带 `Authorization`）；「控制台」按钮仍走 **`console-messages`** 短时采样。

**Agent `action` 别名（旧客户端兼容）**

| 旧 `action` | 当前 canonical | 说明 |
|-------------|------------------|------|
| `topology`  | `state`          | 与 `GET /v1/sessions/:id/list-window` 同源的快照 JSON（旧名 topology） |
| `dom`       | `get`            | 目标页 `outerHTML`（整页 HTML，可能截断） |

**CLI（Core 包 `od` / `yarn oc`）**：

- **App-first（不写 session id，按应用解析活跃会话）**：形式为 **`yarn oc <appId> <子命令>`**（workspace 脚本；**全局安装**时入口名为 **`od`**，语义相同）。`<appId>` **须与 Core 注册的应用 id 一致**（`yarn oc app list`），例如 `demo-mock` 或 `xiezuo-dev`；勿与本地 yarn 脚本名或简称混用。
  - **子命令**：`list-window`（CDP 目标列表快照）、`metrics`、`snapshot`（Agent 快照）、`list-global`（`renderer-globals` / 全局枚举）、**`explore`**（`action: explore`，解析 DOM 返回按钮候选）。**`topology`** 与 **`list-window` 等价**（兼容旧名）。
  - **list-global**：**未传 `--target`** 时使用 list-window 拓扑中的**第一个** target；传入 `--target <targetId>` 则指定目标。可选 `--interest <pattern>`、`--max-keys <n>`（等同 Agent `renderer-globals`，需 `allowScriptExecution`）。可选 `--session <uuid>` 固定会话。
  - **explore**：同上，未传 `--target` 时对拓扑中**第一个** page target 做 `explore`。可选 `--max-candidates <n>`、`--min-score <0~1>`、`--include-anchor-buttons`（与 Agent `explore` 一致，**不需** `allowScriptExecution`）。
  - **其它全局选项**：`--format table|json` 等见 `od --help` 文末说明。
- **通用 Agent**：`agent action <sessionId> --json '<JSON>'` 调用 `POST /v1/agent/sessions/:id/actions`；不传 `--json` 时从 **stdin** 读入整段 JSON（便于管道传入）。

**环境变量**：`OPENDESKTOP_AGENT_API=0` 关闭 `/v1/agent/`*；`OPENDESKTOP_EXTENDED_LOGS=0` 时 SSE 仅下发 `ts/stream/line`；`OPENDESKTOP_AGENT_RPM` 控制 Agent 每分钟请求上限（默认 120）；`OPENDESKTOP_RECIPES_DIR` 覆盖操作配方根路径（默认 `<OPENDESKTOP_DATA_DIR>/recipes`）。

## Playwright `connectOverCDP`

在会话 `running` 且 `cdpPort` 已就绪后，可通过 Core 暴露的网关访问（示例）：

```txt
http://127.0.0.1:<corePort>/v1/sessions/<sessionId>/cdp
```

具体路径与 Playwright 版本请以 `GET /v1/sessions/:id` 返回信息与 `GET /json/version` 联调为准。

## 开发环境如何启动

先保证 **Node ≥ 20**（例如 `nvm use 20`），安装依赖：

**在 `openDesktop/` 目录下**（推荐，依赖装在这里）：

```bash
cd openDesktop
yarn install   # 或 npm install
```

**若你站在仓库最外层 `opensource/`**：顶层 `package.json` 已提供同名脚本，会先 `yarn --cwd openDesktop …`，但**仍需先在 `openDesktop` 里装过依赖**。例如：

```bash
cd openDesktop && yarn install && cd ..
yarn dev:core
```

下面三种方式按场景选用。

### 方式一：只调 Core（TypeScript 直接跑，不必先 `build`）

在仓库根目录 `openDesktop/` 下：

```bash
yarn dev:core
```

等价于 `yarn workspace @opendesktop/core dev -- core start --port 8787`（用 `tsx` 跑源码 CLI，改 `packages/core/src` 后重启即可）。

需要 **Core 同源托管已构建的 Web**（先打一次前端）：

```bash
yarn build -w @opendesktop/web
yarn dev:core:ui
```

### 方式二：前后端分开（适合狂改 `packages/web`）

**终端 1 — Core：**

```bash
yarn dev:core
```

**终端 2 — Vite 热更新：**

```bash
yarn dev:web
```

浏览器一般打开 **[http://127.0.0.1:5173](http://127.0.0.1:5173)**（以 Vite 终端输出为准）。**API Base 可留空**：请求走 `/v1`，由 Vite **代理到** Core `8787` 端口。也可显式填 `http://127.0.0.1:8787`（Core 已对本机 Origin 开 CORS）。**Bearer token** 用终端里 `Token:` 或 `token.txt`。

### 方式三：与生产一致（同源）

先构建再只用 Core 托管前端：

```bash
npm run build
npm run od -- core start --web-dist "$(pwd)/packages/web/dist"
```

---

## 开发常用命令

```bash
npm run test -w @opendesktop/core
npm run test:watch -w @opendesktop/core   # packages/core 内 vitest 监听
npm run lint -w @opendesktop/core
```

## 仓库结构

- `packages/core`：守护进程、HTTP API、CDP 代理、CLI（`od`）
- `packages/web`：Vite + React 只读会话列表（可选）

