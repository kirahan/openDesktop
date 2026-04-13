# HTTP API、UserScript、观测与 Agent（速查）

> **定位**：本文汇总 **Bearer 保护的 Control API**、用户脚本、SSE 观测与 **Agent `actions`** 的常用端点与语义。**权威行为**以 `packages/core` 路由实现与 `openspec/specs/` 下各 capability 为准；CLI 命令见 [CLI.md](./CLI.md)。

**规格索引（节选）**：`app-user-scripts`、`cdp-dom-pick`、`cdp-network-observability`、`cdp-observability-sse-streams`、`local-forward-proxy`、`cli-oc-app-first`、`agent-dom-explore` 等见仓库 `openspec/specs/`。

---

## 按应用用户脚本（UserScript 元数据存储）

将油猴风格 `**// ==UserScript==` … `// ==/UserScript==`** 块写入 Core，按 `**appId`** 归属持久化（文件：`<dataDir>/user-scripts.json`）。解析后的 `**metadata.matches`** 为 `**@match` 原文列表**。`**@match` 不参与是否注入、注入到哪些 CDP target 的决策**（避免与 SPA 客户端路由语义混淆；规格见 `openspec/specs/app-user-scripts/spec.md`）。**不会在后台自动执行脚本**：需在会话 `**running**` 且允许脚本执行时，**显式调用**下方「注入」接口，将当前 app 下全部脚本 **正文** 注入到 **当时 CDP 枚举到的全部 `page` 类型 target**（同一脚本可能在多个 frame target 上各执行一次）。


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

`**@grant`** 仅允许 `**none`**（或可省略）；否则返回 `**USER_SCRIPT_GRANT_NOT_SUPPORTED`**。缺少 `**@name**` 返回 `**USER_SCRIPT_VALIDATION_ERROR**`。均需 **Bearer**。

---

## 安全说明

- Core **默认只监听 127.0.0.1**，请勿在未配置防火墙时绑定 `0.0.0.0`。
- `/v1/sessions/:id/cdp/`* 为调试流量，**不强制 Bearer**，以便 DevTools / CDP 客户端；依赖 **仅本机回环** 与上游会话隔离。
- **CDP 等效高权限**：可执行页面脚本与访问调试协议，勿向公网暴露。
- `**/v1/agent/*`** 与语义动作受 Bearer + **限流**约束；会改导航、执行脚本或模拟输入的动作（如 `open`、`eval`、`click`、`type`、`back`、`close`、`renderer-globals`、`runtime-exception`、`**POST .../user-scripts/inject`**、`**POST .../dom-pick/arm`**、`**POST .../dom-pick/resolve**` 等）需会话侧 `**allowScriptExecution: true**`（`**POST /v1/profiles` 新建 Profile 时默认 `true**`；旧数据或未迁移会话仍可能为 `false`，可显式传 `allowScriptExecution: false` 关闭）。只读类（如 `state`、`get`、`explore`、`screenshot`、`network`、`network-observe`、`console-messages`、`window-state`）以及仅 `ms`、不含 `selector` 的 `wait`、以及窗口前置 `focus-window` 不需要。

---

## 语义层与可观测 API（Bearer）

`GET /v1/sessions`、单条 `GET /v1/sessions/:id` 与会话创建响应中的会话对象含 **`uiRuntime`**：`"electron"` | `"qt"`，由 Profile → App 解析，缺省 **`electron`**。`GET` / `POST` / `PATCH /v1/apps` 支持可选 **`uiRuntime`**（同上）；非法值 **400** `VALIDATION_ERROR`。

会话 `running` 且 CDP 可用时：


| 端点                                                            | 说明                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /v1/sessions/:id/list-window`                            | 窗口/调试目标列表（归一化 CDP `/json/list`）；`/topology` 为兼容别名                                                  |
| `GET /v1/sessions/:id/native-accessibility-tree`               | **仅 macOS**：按会话子进程 **PID** 枚举系统 Accessibility（AX）UI 树（Qt 等无 CDP 页面）。Query：`maxDepth`（默认 12，上限 50）、`maxNodes`（默认 5000，上限 50000）。成功：`{ truncated, root }`。须会话 **`running`** 且已有 **`pid`**。 |
| `GET /v1/sessions/:id/native-accessibility-at-point`          | **仅 macOS**：在**屏幕坐标**处命中该 PID 应用前台的 AX 元素，返回命中节点、**祖先链**与**局部子树**（与整树 JSON 形态兼容）。Query：可选 **`x`** / **`y`**（整数像素）；省略时由 Core 通过 **`@nut-tree/nut-js`** 读取**全局鼠标位置**（失败时 **`400`** `MOUSE_POSITION_UNAVAILABLE`）。另有 `maxAncestorDepth`、`maxLocalDepth`、`maxNodes` 与截断标记。须会话 **`running`** 且已有 **`pid`**；`GET /v1/version` 的 **`capabilities`** 在 darwin 上含 **`native_accessibility_at_point`**。 |
| `GET /v1/sessions/:id/metrics`                                | 子进程 CPU/内存；不可得时 `metrics: null` + `reason`                                                         |
| `GET /v1/sessions/:id/console/stream?targetId=<id>`           | **SSE**：`Runtime.consoleAPICalled`（仅连接后的新日志）。与 Agent `console-messages` **短时采样**互补，**不含 Network**。 |
| `GET /v1/sessions/:id/network/stream?targetId=<id>`           | **SSE**：请求完成元数据 JSON（无 body）。可选 `stripQuery`、`maxEventsPerSecond`。                                 |
| `GET /v1/sessions/:id/proxy/stream`                           | **SSE**：本地转发代理观测（`proxyRequestComplete`）。专用代理未启用时 **503**。                                         |
| `GET /v1/sessions/:id/runtime-exception/stream?targetId=<id>` | **SSE**：`Runtime.exceptionThrown`。须 `allowScriptExecution: true`。                                  |
| `POST /v1/sessions/:id/replay/recording/start`                 | **JSON** Body：`{ "targetId": "<page targetId>" }`，可选 `"injectPageControls": true`（默认 false）。对单 page 开启矢量录制：CDP 注入监听脚本，并 `Runtime.addBinding` 注册 **`odOpenDesktopReplay`**（矢量 JSON 数据）。`injectPageControls` 为 true 时再注册第二条 binding **`odOpenDesktopReplayUi`**，并在页面注入底部悬浮控制条（根节点 id `__odReplayControlBar`）；控制条上的指针/点击不会写入矢量 JSON，指令经 UI binding 回传（见下）。须 `running` 且 `allowScriptExecution: true`。 |
| `POST /v1/sessions/:id/replay/recording/stop`                  | **JSON** Body：`{ "targetId": "<page targetId>" }`。停止录制并释放注入。无活跃录制时 **409** `RECORDER_NOT_ACTIVE`。 |
| `GET /v1/sessions/:id/replay/stream?targetId=<id>`             | **SSE**：推送录制事件 JSON（`data:` 行）。须**先** `replay/recording/start` 且会话仍 `running`，否则 **503** `RECORDER_NOT_ACTIVE`。并发连接上限与 **429** `REPLAY_SSE_STREAM_LIMIT` 见实现。 |
| `POST /v1/sessions/:id/rrweb/recording/start`                  | **JSON** Body：`{ "targetId": "<page targetId>" }`。对单 page 注入构建产物 `inject.bundle.js`（IIFE）并 `Runtime.addBinding`（binding 名 `odOpenDesktopRrweb`）。须 `running` 且 `allowScriptExecution: true`。未构建注入包时 **503** `RRWEB_BUNDLE_NOT_FOUND`。 |
| `POST /v1/sessions/:id/targets/:targetId/rrweb/inject`         | 与上一行等价，`targetId` 取自路径。 |
| `POST /v1/sessions/:id/rrweb/recording/stop`                   | **JSON** Body：`{ "targetId": "<page targetId>" }`。停止 rrweb 录制并移除 binding。无活跃录制时 **409** `RRWEB_RECORDER_NOT_ACTIVE`。 |
| `GET /v1/sessions/:id/rrweb/stream?targetId=<id>`            | **SSE**：`data:` 行为 rrweb 事件 JSON（`type` 为数字）。须**先** `rrweb/recording/start` 或 `.../rrweb/inject`，否则 **503** `RRWEB_RECORDER_NOT_ACTIVE`。并发连接上限与 **429** `RRWEB_SSE_STREAM_LIMIT` 见实现；`event: ready` 中带 `rrwebBundleVersion`（与 Core 常量 `RRWEB_INJECT_BUNDLE_VERSION` 一致，当前与 npm `rrweb` **1.1.3** 对齐）。**说明**：注入后录制会立即产生 Meta(4) 与 FullSnapshot(2)，若晚于该时刻才连 SSE，旧实现会丢失基线；Core 会**缓冲**近期事件行并在新连接上**先重放缓冲**再推送增量（缓冲有上限，极长会话仍以当时缓冲为准）。 |
| `POST /v1/sessions/:id/test-recording-artifacts`              | **JSON**：将矢量录制 NDJSON 行或完整制品写入磁盘，供后续 LLM 生成用例。须会话 **running**；**201** 响应含 `recordingId`、`path`（绝对路径）、`artifact`。二选一 Body：① `targetId` + `replayLines`（字符串数组，每元素一条与 `replay/stream` 一致的 JSON）；② 完整 `artifact`（须与 URL 中 `sessionId`、Profile 对应 `appId` 一致）。可选 `recordingId`（省略则自动生成）、`notes`、`pageContext`。 |
| `GET /v1/apps/:appId/test-recording-artifacts`                | 列出该应用下已保存的测试录制 id（`recordingIds` 数组）。 |
| `GET /v1/apps/:appId/test-recording-artifacts/:recordingId`   | 读取单份制品 JSON；不存在则 **404**。 |
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

`GET /v1/version` 的 `capabilities`、`sseObservabilityStreams` / `sseObservabilityStreamPaths` 可用于探测能力（含 `page_session_replay` / `pageReplay` 与 `session_replay_rrweb` / `rrweb` 路径）。在 **macOS** 上若 Core 已编译并启用对应路径，`capabilities` 中会额外包含 **`native_accessibility_tree`**，以及按点采集能力 **`native_accessibility_at_point`**（与 `.../native-accessibility-at-point` 对应）。

**`GET .../native-accessibility-tree`（仅 macOS）**

- **前置**：会话 `running` 且 `pid` 已记录；终端或 `opd` 二进制须在 **系统设置 → 隐私与安全性 → 辅助功能** 中授权，否则常见 **`403`**，错误码 **`ACCESSIBILITY_DISABLED`**。
- **非 macOS**：**`400`** `PLATFORM_UNSUPPORTED`。
- **会话不存在**：**`404`** `SESSION_NOT_FOUND`；未运行 / 无 pid：**`400`** `SESSION_NOT_READY` / `PID_UNAVAILABLE`。
- 其它 AX/ Swift 失败多为 **`422`**，具体见响应 `error.code`（如 `SWIFT_UNAVAILABLE`、`AX_ERROR` 等）。

**`GET .../native-accessibility-at-point`（仅 macOS）**

- **前置**：与整树相同（`running`、`pid`、辅助功能授权）；未授权时同样常见 **`403`** **`ACCESSIBILITY_DISABLED`**。
- **无 `x`/`y` 时**：依赖 **`@nut-tree/nut-js`** 读取全局鼠标坐标；若读取失败：**`400`** **`MOUSE_POSITION_UNAVAILABLE`**。该依赖在部分环境需满足其自身的运行时/预编译要求，详见 npm 包说明。
- **非 macOS**：**`400`** `PLATFORM_UNSUPPORTED`；会话 / pid 类错误与整树一致。
- 成功响应在 **`mode: "at"`** 时含 **`at`**、**`ancestors`**、**`screenX`/`screenY`** 等字段；与 Studio 中「鼠标周围」视图对应。

**矢量录制事件示例**（`schemaVersion` 为 1；坐标为视口 CSS 像素，附 `viewportWidth` / `viewportHeight`）：

```json
{
  "schemaVersion": 1,
  "type": "pointermove",
  "ts": 1712812800000,
  "x": 120.5,
  "y": 64,
  "viewportWidth": 1280,
  "viewportHeight": 720
}
```

`click` 事件可带可选字段 `target`，为点击目标节点的有限摘要（标签、`id`、`className`、若干 `data-*`、简化 `selector`、`role`），便于区分点了哪个元素；字段长度与条数在 Core 解析侧有上限。

**人工分段标记**：流中可出现 `type` 为 **`segment_start`** 与 **`segment_end`** 的行（宜成对），用于圈定场景边界；语义与校验见实现侧 `session-replay/schema`。单次 **`POST .../test-recording-artifacts`** 的请求体仍只是**一份** `replayLines`；若要将同一缓冲区分成多份磁盘制品，由**客户端**多次调用该接口并为每次指定不同 **`recordingId`**（控制台在存在上述标记时的拆分策略见 `packages/web/README.md`）。

**页面内控制条与第二条 binding**：仅在 `injectPageControls: true` 时启用。UI binding 载荷为 JSON 对象：`{"cmd":"stop"}` 停止矢量录制；`{"cmd":"checkpoint"}` 向 `replay/stream` 推送一行 **`assertion_checkpoint`**（可选 `note` 字符串，长度有上限），用于标记断言/检查点时刻，**不**替代页面真实交互产生的矢量事件。控制条交互不应进入矢量 NDJSON；若需自动化，请通过该 UI 通道而非篡改矢量 JSON。

**assertion_checkpoint** 行示例：

```json
{
  "schemaVersion": 1,
  "type": "assertion_checkpoint",
  "ts": 1712812800000,
  "note": "expected dashboard"
}
```

```json
{
  "schemaVersion": 1,
  "type": "click",
  "ts": 1712812800000,
  "x": 120.5,
  "y": 64,
  "viewportWidth": 1280,
  "viewportHeight": 720,
  "target": {
    "tagName": "button",
    "id": "submit",
    "className": "btn primary",
    "data": { "data-testid": "ok" },
    "selector": "main > form > button#submit",
    "role": "button"
  }
}
```

**rrweb 与隐私默认值**：注入包内 `rrweb.record` 使用 **`maskAllInputs: true`**（输入类控件内容打码）；仍可能包含 URL、标题与 DOM 结构，请按合规要求使用。

**本地转发代理与目标应用**：已注册应用开启 **专用代理** 时，启动流程会注入 `HTTP_PROXY`/`HTTPS_PROXY`。若目标应用忽略环境变量，可能导致 `proxy/stream` 无事件。详见根目录 [README](../README.md) 与 [packages/web/README.md](../packages/web/README.md)「本地转发代理」。

**操作配方目录**：默认 `<数据目录>/recipes/`；环境变量 `OPENDESKTOP_RECIPES_DIR`。步骤与 DOM 探索兜底见主 README 历史说明与 `openspec/specs/cdp-operation-recipes`。

**应用侧 JSON 记录（测试录制等）**：默认根目录为 **`<数据目录>/app-json/`**，其下 **每个应用 id 一个子目录**，文件形如 `test-recording-<recordingId>.json`。可用环境变量 **`OPENDESKTOP_APP_JSON_DIR`** 将整个根目录指到其它绝对路径。制品可能含页面文本与 URL，默认视为本地调试数据，请勿在未脱敏时上传公网。规格见主文档 [`openspec/specs/test-recording-llm-capture/spec.md`](../openspec/specs/test-recording-llm-capture/spec.md)；页面矢量控制条能力见 [`openspec/specs/vector-replay-page-controls/spec.md`](../openspec/specs/vector-replay-page-controls/spec.md)。历史归档变更仍保留在 `openspec/changes/archive/` 下对应目录。

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
| `OPENDESKTOP_APP_JSON_DIR`    | 应用侧 JSON 记录根路径（默认数据目录下 `app-json`） |


---

## Playwright `connectOverCDP`

会话 `running` 且 `cdpPort` 就绪后，经 Core 网关（示例）：

```txt
http://127.0.0.1:<corePort>/v1/sessions/<sessionId>/cdp
```

具体路径与 Playwright 版本请以 `GET /v1/sessions/:id` 与 `GET /json/version` 联调为准。