# HTTP API、UserScript、观测与 Agent（速查）

> **定位**：本文汇总 **Bearer 保护的 Control API**、用户脚本、SSE 观测与 **Agent `actions`** 的常用端点与语义。**权威行为**以 `packages/core` 路由实现与 `openspec/specs/` 下各 capability 为准；CLI 命令见 [CLI.md](./CLI.md)。

**规格索引（节选）**：`app-user-scripts`、`cdp-dom-pick`、`cdp-network-observability`、`cdp-observability-sse-streams`、`local-forward-proxy`、`cli-oc-app-first`、`agent-dom-explore` 等见仓库 `openspec/specs/`。

---

## 按应用用户脚本（UserScript 元数据存储）

将油猴风格 `**// ==UserScript==` … `// ==/UserScript==`** 块写入 Core，按 `**appId**` 归属持久化（文件：`<dataDir>/user-scripts.json`）。解析后的 `**metadata.matches**` 为 `**@match` 原文列表**。`**@match` 不参与是否注入、注入到哪些 CDP target 的决策**（避免与 SPA 客户端路由语义混淆；规格见 `openspec/specs/app-user-scripts/spec.md`）。**不会在后台自动执行脚本**：需在会话 `**running**` 且允许脚本执行时，**显式调用**下方「注入」接口，将当前 app 下全部脚本 **正文** 注入到 **当时 CDP 枚举到的全部 `page` 类型 target**（同一脚本可能在多个 frame target 上各执行一次）。


| 方法       | 路径                                                           | 说明                                                                                                                                               |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST`   | `/v1/apps/:appId/user-scripts`                               | Body：`{ "source": "<完整 .user.js 文本>" }`；成功 **201**，响应含 `script.metadata.matches`                                                                 |
| `GET`    | `/v1/apps/:appId/user-scripts`                               | 列出该 app 下脚本                                                                                                                                      |
| `GET`    | `/v1/apps/:appId/user-scripts/:scriptId`                     | 单条                                                                                                                                               |
| `PATCH`  | `/v1/apps/:appId/user-scripts/:scriptId`                     | Body：`{ "source": "..." }`                                                                                                                       |
| `DELETE` | `/v1/apps/:appId/user-scripts/:scriptId`                     | 成功 **204**                                                                                                                                       |
| `POST`   | `/v1/sessions/:sessionId/user-scripts/inject`                | **显式注入**（Bearer）：将该会话 Profile 所属 `appId` 下全部脚本正文注入全部 `page` target；需 `**allowScriptExecution: true**`；响应含 `injectedScripts`、`targets`、`errors[]` |
| `POST`   | `/v1/sessions/:sessionId/targets/:targetId/dom-pick/arm`     | **DOM 拾取（spike）**：向目标 `page` 注入 `pointerdown` 监听，将坐标写入 `window.__odDomPickLast`；需 `**allowScriptExecution: true**`                               |
| `POST`   | `/v1/sessions/:sessionId/targets/:targetId/dom-pick/resolve` | **DOM 拾取**：读取并清空上述坐标，用 `**DOM.getNodeForLocation` + `DOM.describeNode**` 返回 `pick` + `node`；无记录时 **400** `DOM_PICK_EMPTY`                        |


**DOM 拾取（spike）流程**：先 `**dom-pick/arm**` → 在**被测应用窗口**内对页面 `**pointerdown**`（与常见「点击」一致）→ 再 `**dom-pick/resolve**` 取节点摘要。仅面向 **单一 `page` target`**；**无**操作系统级全局鼠标钩子。行为见` openspec/specs/cdp-dom-pick/spec.md`。

`**@grant`** 仅允许 `**none**`（或可省略）；否则返回 `**USER_SCRIPT_GRANT_NOT_SUPPORTED**`。缺少 `**@name**` 返回 `**USER_SCRIPT_VALIDATION_ERROR**`。均需 **Bearer**。

---

## 安全说明

- Core **默认只监听 127.0.0.1**，请勿在未配置防火墙时绑定 `0.0.0.0`。
- `/v1/sessions/:id/cdp/`* 为调试流量，**不强制 Bearer**，以便 DevTools / CDP 客户端；依赖 **仅本机回环** 与上游会话隔离。
- **CDP 等效高权限**：可执行页面脚本与访问调试协议，勿向公网暴露。
- `**/v1/agent/*`** 与语义动作受 Bearer + **限流**约束；会改导航、执行脚本或模拟输入的动作（如 `open`、`eval`、`click`、`type`、`back`、`close`、`renderer-globals`、`runtime-exception`、`**POST .../user-scripts/inject`**、`**POST .../dom-pick/arm**`、`**POST .../dom-pick/resolve**` 等）需会话侧 `**allowScriptExecution: true**`（`**POST /v1/profiles` 新建 Profile 时默认 `true**`；旧数据或未迁移会话仍可能为 `false`，可显式传 `allowScriptExecution: false` 关闭）。只读类（如 `state`、`get`、`explore`、`screenshot`、`network`、`network-observe`、`console-messages`、`window-state`）以及仅 `ms`、不含 `selector` 的 `wait`、以及窗口前置 `focus-window` 不需要。

---

## 语义层与可观测 API（Bearer）

会话 `running` 且 CDP 可用时：


| 端点                                                            | 说明                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /v1/sessions/:id/list-window`                            | 窗口/调试目标列表（归一化 CDP `/json/list`）；`/topology` 为兼容别名                                                  |
| `GET /v1/sessions/:id/metrics`                                | 子进程 CPU/内存；不可得时 `metrics: null` + `reason`                                                         |
| `GET /v1/sessions/:id/console/stream?targetId=<id>`           | **SSE**：`Runtime.consoleAPICalled`（仅连接后的新日志）。与 Agent `console-messages` **短时采样**互补，**不含 Network**。 |
| `GET /v1/sessions/:id/network/stream?targetId=<id>`           | **SSE**：请求完成元数据 JSON（无 body）。可选 `stripQuery`、`maxEventsPerSecond`。                                 |
| `GET /v1/sessions/:id/proxy/stream`                           | **SSE**：本地转发代理观测（`proxyRequestComplete`）。专用代理未启用时 **503**。                                         |
| `GET /v1/sessions/:id/runtime-exception/stream?targetId=<id>` | **SSE**：`Runtime.exceptionThrown`。须 `allowScriptExecution: true`。                                  |
| `GET /v1/sessions/:id/logs/export?format=jsonl&level=error`   | 日志导出                                                                                               |
| `GET /v1/agent/sessions/:id/snapshot`                         | OODA 结构化快照                                                                                         |
| `POST /v1/agent/sessions/:id/actions`                         | Agent 动词，见下表                                                                                       |
| `GET /v1/agent/sessions/:id/recipes?app=<slug>`               | 列出配方                                                                                               |
| `GET /v1/agent/sessions/:id/recipes/:appSlug/:recipeId`       | 读取配方                                                                                               |
| `POST /v1/agent/sessions/:id/recipes/:appSlug/:recipeId/run`  | 执行配方（需 `allowScriptExecution`）                                                                     |


`curl -N` 消费网络观测 SSE 示例：

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8787/v1/sessions/$SESSION/network/stream?targetId=$TARGET"
```

`GET /v1/version` 的 `capabilities`、`sseObservabilityStreams` / `sseObservabilityStreamPaths` 可用于探测能力。

**本地转发代理与目标应用**：已注册应用开启 **专用代理** 时，启动流程会注入 `HTTP_PROXY`/`HTTPS_PROXY`。若目标应用忽略环境变量，可能导致 `**proxy/stream` 无事件**。详见根目录 [README](../README.md) 与 [packages/web/README.md](../packages/web/README.md)「本地转发代理」。

**操作配方目录**：默认 `<数据目录>/recipes/`；环境变量 `OPENDESKTOP_RECIPES_DIR`。步骤与 DOM 探索兜底见主 README 历史说明与 `openspec/specs/cdp-operation-recipes`。

---

## Agent 动词表（节选）


| `action`            | 说明          | 主要请求字段                           | 备注                       |
| ------------------- | ----------- | -------------------------------- | ------------------------ |
| `open`              | 导航到 `url`   | `targetId`, `url`                | 需 `allowScriptExecution` |
| `state`             | 拓扑快照        | `targetId` 可选                    | 与 list-window 同源形态       |
| `click`             | 点击          | `targetId`, `selector`           | 需脚本                      |
| `type`              | 输入文本        | `targetId`, `selector`, `text`   | 需脚本                      |
| `get`               | `outerHTML` | `targetId`                       | 只读                       |
| `explore`           | DOM 候选按钮    | `targetId`                       | 只读解析，不需脚本                |
| `screenshot`        | PNG Base64  | `targetId`                       |                          |
| `network-observe`   | 短时网络聚合      | `targetId` 等                     | 不需脚本                     |
| `renderer-globals`  | 全局属性枚举      | `targetId`, 可选 `interestPattern` | 需脚本                      |
| `console-messages`  | 短时控制台       | `targetId`, `waitMs`             | OpenDesktop 扩展           |
| `runtime-exception` | 未捕获异常       | `targetId`, `waitMs`             | 需脚本                      |


完整表与实现状态见历史主 README 迁移前的长表或代码；**CLI 侧 App-first 与 `agent action`** 见 [CLI.md](./CLI.md)。

**Agent `action` 别名**：`topology` → `state`；`dom` → `get`。

---

## 环境变量（节选）


| 变量                            | 作用                       |
| ----------------------------- | ------------------------ |
| `OPENDESKTOP_AGENT_API=0`     | 关闭 `/v1/agent/`*         |
| `OPENDESKTOP_EXTENDED_LOGS=0` | SSE 仅下发 `ts/stream/line` |
| `OPENDESKTOP_AGENT_RPM`       | Agent 每分钟请求上限（默认 120）    |
| `OPENDESKTOP_RECIPES_DIR`     | 操作配方根路径                  |


---

## Playwright `connectOverCDP`

会话 `running` 且 `cdpPort` 就绪后，经 Core 网关（示例）：

```txt
http://127.0.0.1:<corePort>/v1/sessions/<sessionId>/cdp
```

具体路径与 Playwright 版本请以 `GET /v1/sessions/:id` 与 `GET /json/version` 联调为准。