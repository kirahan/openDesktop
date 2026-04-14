# OpenDesktop: external agent skill (copy into Cursor or Claude)

**Purpose:** Give any LLM agent a **repeatable, step-by-step** playbook to drive **OpenDesktop Core** (CLI + HTTP API) against a **local Electron app** (debugging port injected). Paste this whole file into a project rule, a Skill, or a system prompt.

**Scope:** Control-plane only (install CLI, start Core, register app, session, CDP, Agent `actions`, **observability semantics** below). Authoritative HTTP details remain in upstream `docs/API.md` and `docs/CLI.md` when this file is copied without the repo.

---

## Complement: Vector replay NDJSON and Agent `click`

- **Vector replay**（先 `replay/recording/start`，再订阅 `GET .../replay/stream`）按行推送 **NDJSON**（如 `pointermove`、`click`、`segment_start` / `segment_end`、`assertion_checkpoint` 等），详见 `docs/API.md`。
- **与 Agent 配合复现路径**：落盘或手工整理的制品里，每个 `**click`** 步骤常带 `**capture.vectorTarget.selector**`（与页面 `document.querySelector` 一致）。对同一 `**targetId**`（由 `GET .../list-window` 选定）依次 `**POST .../agent/sessions/:id/actions**`，body 为 `{ "action": "click", "targetId", "selector" }`，即可重放录制中的点击链。录制里若含 `**structureAnchor**` 等长文本，仅作理解上下文，**不要**当作 selector。
- **脆弱性**：长链 `**nth-of-type`** 在 UI 结构变化后易失效；失败时用 App-first `**explore**`、或 Playwright 经 CDP 网关的 `**ariaSnapshot()**`（见下文 Optional 节）更新 selector。
- **多文件落盘**：控制台按 `**segment_start` / `segment_end`** 拆多次 `test-recording-artifacts` 为 **Web 侧策略**，非 Core 单次 API 的必选语义；见 `packages/web/README.md`。

---

## Install OpenDesktop CLI (`opd`)

The published package is `**@hanzhao111/opendesktop`**. The global command is `**opd`** (not `od`, to avoid clashing with Git for Windows).

**Requirements:** **Node.js ≥ 20.19** (see package `engines`).

**Install (global):**

```bash
npm install -g @hanzhao111/opendesktop
opd --help
```

Verify:

```bash
opd core start --port 8787
```

(On first run, Core prints a **Token** and writes `**token.txt`** under the default data directory; see below.)

**Optional — local install from a clone / tarball:** See the repo’s `packages/opendesktop/README.md` and `docs/npm-publish.md` (sync `dist` + `web-dist`, then `npm install -g .` or pack-based install). Agents following this skill should prefer `**npm install -g @hanzhao111/opendesktop`** unless the user explicitly develops from source.

---

## Prerequisites (after install)

1. **Core is running**, e.g. `opd core start --port 8787` (default API base `http://127.0.0.1:8787` unless changed with `--port` / `--host` or env).
2. **Bearer token** for `/v1/*` (CDP proxy paths are documented as localhost-oriented). Default token file on Windows: `%APPDATA%\OpenDesktop\token.txt`; Core also prints `Token:` at startup.
3. **Electron path:** Prefer the **real app binary** (often `...\Application\app\MyApp.exe`), not a **launcher** in the parent folder that exits immediately (`exit code 0`). If sessions stay `failed` with `child exited during startup`, fix the registered `executable` path first.

---

## Full `opd` CLI reference (published npm build)

**Authoritative text:** Run `**opd --help`** and `**opd <command> --help`** on the installed package. Below matches the **Commander** tree in Core (`packages/core/src/cli.ts`); flags use the same names as the CLI.

**Top-level subcommands（当前 npm 包）:** `core`、`app`、`profile`、`session`、`agent`、`doctor`、`open`。根级还有 `**-h` / `--help`**、`**-V` / `--version`**。**  
**说明： 解析 App-first 时会把 `**cdp`** 当作保留字（避免 `opd cdp …` 被误当成应用 id），**并不等于**已实现 `opd cdp` 子命令；若将来增加，以 `**opd --help`** 为准。

### Global options (before subcommands)


| Option                | Env fallback             | Meaning                                                                    |
| --------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `--api-url <url>`     | `OPENDESKTOP_API_URL`    | Core HTTP base (default `http://127.0.0.1:8787` when unset in many flows). |
| `--token-file <path>` | `OPENDESKTOP_TOKEN_FILE` | Bearer token file for `/v1/`* calls.                                       |


Example when Core uses a non-default port:

```bash
opd --api-url http://127.0.0.1:9000 --token-file "%APPDATA%\OpenDesktop\token.txt" session list
```

---

### `opd core` — Core process


| Command    | Usage                                                                              | Notes                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **start**  | `opd core start [--port <n>] [--host <h>] [--data-dir <path>] [--web-dist <path>]` | Foreground Core. Default port **8787**, host **127.0.0.1**. Web static dir: `**--web-dist`** > `OPENDESKTOP_WEB_DIST` > bundled `web-dist` next to CLI when present. |
| **status** | `opd core status`                                                                  | Reads pid file under data dir; exit **1** if not running or stale pid.                                                                                               |
| **stop**   | `opd core stop`                                                                    | **SIGTERM** to pid from pid file.                                                                                                                                    |


---

### `opd app` — Registered applications


| Command       | Usage                                                                                                                      | Notes                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **list**      | `opd app list`                                                                                                             | **GET** `/v1/apps` (JSON to stdout).                                                                                                                                           |
| **init-demo** | `opd app init-demo`                                                                                                        | Registers built-in **demo-mock** app + **demo** profile (mock CDP child for integration tests).                                                                                |
| **create**    | `opd app create --id <id> --exe <path> [--cwd <path>] [--args <json>] [--skip-debug-inject] [--profile-id <id>] [--start]` | **Required:** `--id`, `--exe`. Default `--cwd` is current working directory; default `--args` is `[]`. `**--start`**: create default profile then start a session immediately. |
| **remove**    | `opd app remove --id <id>`                                                                                                 | Deletes app; stops related sessions; removes profiles / user-script records for that app.                                                                                      |


---

### `opd profile` — Launch profiles


| Command  | Usage              | Notes                          |
| -------- | ------------------ | ------------------------------ |
| **list** | `opd profile list` | **GET** `/v1/profiles` (JSON). |


---

### `opd session` — Debug sessions


| Command   | Usage                           | Notes                                                    |
| --------- | ------------------------------- | -------------------------------------------------------- |
| **list**  | `opd session list [-f table     | json]`                                                   |
| **start** | `opd session start <profileId>` | **POST** `/v1/sessions` — **new** session id every time. |
| **stop**  | `opd session stop <sessionId>`  | **POST** `/v1/sessions/:id/stop`.                        |


---

### `opd agent` — Agent HTTP wrapper


| Command    | Usage                                            | Notes                                                                                                                                    |
| ---------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **action** | `opd agent action <sessionId> [--json '<JSON>']` | **POST** `/v1/agent/sessions/:sessionId/actions`. Body from `**--json`** or **stdin** (stdin if `--json` omitted). Prints response JSON. |


Example (stdin):

```bash
echo '{"action":"state"}' | opd agent action <sessionId>
```

---

### `opd doctor` — Connectivity check


| Command    | Usage                 | Notes           |
| ---------- | --------------------- | --------------- |
| **doctor** | `opd doctor [-f table | json] [--app ]` |


---

### `opd open` — Open browser


| Command  | Usage                   | Notes                                                                                                                                 |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **open** | `opd open [--path <p>]` | Default path `**/`** under Core base URL (from `--api-url` / env / default 8787). Prints URL and opens default browser (OS-specific). |


---

### App-first mode (no `session` subcommand in the argv)

**Form:** `opd [global options] <appId> <subcommand>`

Resolves the **latest active session** for registered `**appId`**, then runs the observation / snapshot verb. Reserved first positional words（不能当应用 id）包括：`core`、`app`、`session`、`open`、`doctor`、`cdp`、`agent` 以及 `-h` / `--help` / `-V` / `--version`。其中 `**cdp`** 仅为保留路由名；当前 CLI 无独立 `opd cdp` 命令。

**Subcommands:** `list-window` (recommended), `topology` (alias of list-window), `snapshot`, `metrics`, `list-global`, `explore`, `network-observe`, `network-stream`, `console-observe`, `console-stream`, `stack-observe`, `stack-stream`.

**Common flags (where applicable):**


| Flag                                                          | Applies to                           | Meaning                                                                            |
| ------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `--session <uuid>`                                            | Most                                 | Pin a specific session instead of “latest for app”.                                |
| `-f`, `--format table                                         | json`                                | Output                                                                             |
| `--target <targetId>`                                         | Several                              | CDP page target id; if omitted, Core may pick first **page** target from topology. |
| `--interest <pattern>`                                        | `list-global`                        | Filter renderer globals.                                                           |
| `--max-keys <n>`                                              | `list-global`                        | Limit keys.                                                                        |
| `--max-candidates`, `--min-score`, `--include-anchor-buttons` | `explore`                            | DOM explore tuning.                                                                |
| `--window-ms`, `--slow-ms`, `--no-strip-query`                | `network-observe` / `network-stream` | Network observation window and URL stripping.                                      |
| `--max-events-per-second <n>`                                 | `network-stream`                     | SSE throttle (1–200).                                                              |
| `--wait-ms <n>`                                               | `console-observe`, `stack-observe`   | Short sampling window (100–30000 ms).                                              |


**Examples:**

```bash
opd myapp list-window -f json
opd myapp metrics
opd myapp snapshot --target <targetId>
opd myapp explore --max-candidates 20
opd myapp network-observe --window-ms 5000
```

SSE streams (`network-stream`, `console-stream`, `stack-stream`) are long-lived; stop with Ctrl+C.

---

## Observability: HTTPS traffic, console logs, stacks (main vs renderer)

This section explains **what each path actually observes**, so agents do not confuse **CDP page traffic** with **Electron main-process HTTP** or **local proxy** traffic.

### CDP `targetId` (usually a `page` target)

App-first commands `network-*`, `console-*`, and `stack-*` all require a `**targetId`** (or default to the **first** target from `list-window`, same order as CDP `/json/list`). That target is typically a `**page`** — i.e. a **renderer / web** debugging target.


| Concern                                          | App-first                           | Underlying API                                                                             | What you get                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP(S) in the page’s Chromium network stack** | `network-observe`, `network-stream` | `POST .../actions` with `network-observe`; `**GET /v1/sessions/:id/network/stream`** (SSE) | CDP **Network**-style **metadata** (method, URL, status, timing). **No** request/response **body** in observe or SSE. Default URL display strips query/hash unless `--no-strip-query`. SSE only sees requests **after** the connection opens (no full history). |
| **Renderer console**                             | `console-observe`, `console-stream` | `console-messages` action; `**GET .../console/stream?targetId=`** (SSE)                    | `Runtime.consoleAPICalled` — **new** messages after subscribe for that target; short JSON sample uses `waitMs`.                                                                                                                                                 |
| **Uncaught exceptions + stack frames**           | `stack-observe`, `stack-stream`     | `runtime-exception` action; `**GET .../runtime-exception/stream?targetId=`** (SSE)         | Exception **text** + **frames**. `**stack-observe` / `stack-stream` require `allowScriptExecution: true`** on the session profile; otherwise **403** `SCRIPT_NOT_ALLOWED`.                                                                                      |


**Important:** `network-observe` / `network-stream` describe traffic that CDP **Network** can attach to for **that `targetId`**. They do **not** automatically include arbitrary **Electron main process** `net` / `https` / Node `fetch` calls — those often never appear on a `page` target. Use the **local proxy** path below when outbound traffic is meant to go through Core-injected `**HTTP_PROXY`/`HTTPS_PROXY`**.

### Dedicated local forward proxy (main / env-driven outbound)

When the **registered app** enables **useDedicatedProxy** and the child process **actually uses** the injected `**HTTP_PROXY`/`HTTPS_PROXY`**, Core exposes `**GET /v1/sessions/:sessionId/proxy/stream`** (SSE) with `**proxyRequestComplete**` events. The ready payload notes that HTTPS may appear as CONNECT tunnel only (no MITM) in the current phase — different from full URL inspection on CDP network. If no proxy is active or the app ignores env vars, expect 503 `LOCAL_PROXY_NOT_ACTIVE` or an empty stream. There is no `opd <appId> proxy-stream` CLI; call HTTP directly (e.g. `curl -N` + Bearer). See `**docs/API.md**` and repo README “本地转发代理”.

### Renderer globals vs DOM explore


| App-first     | Agent / HTTP                         | `allowScriptExecution`                                |
| ------------- | ------------------------------------ | ----------------------------------------------------- |
| `list-global` | `renderer-globals`                   | **Required `true`** — otherwise **403**.              |
| `explore`     | `explore` (HTML → button candidates) | **Not** gated on script flag in Core (DOM read path). |


### Logs export and capability probe (HTTP only; no App-first alias)


| Endpoint                               | Role                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `**GET /v1/sessions/:id/logs/export`** | Export process/Core logs (query params such as `format`, `level` — see implementation).                                                      |
| `**GET /v1/version`**                  | `**capabilities`**, `**agentActions`**, `**sseObservabilityStreamPaths**` (paths for network / console / runtime-exception / **proxy** SSE). |


### Not covered by `opd` CLI (see `docs/API.md`)

User scripts (`.../user-scripts`, inject), DOM pick (`.../dom-pick/`*), recipes (`.../recipes/`*), and the **full** Agent verb set beyond what App-first wraps — all **Bearer HTTP** only unless you add your own scripts.

---

## Step 1 — Register the app (once per app id)

Use `**opd`** from any terminal (working directory does not need to be the openDesktop repo):

```bash
opd app create --id <appId> --exe "<absolutePathToExe>" --cwd "<workingDir>" --args "[]"
```

- `--id`: Short name; also used for App-first flows as `opd <appId> <subcommand>` when the app is registered.
- `--exe` / `--cwd`: Must match how the app is meant to start; **Windows paths** can use forward slashes in quoted strings.
- Default profile id is `<appId>-default` unless `--profile-id` is set.
- Do **not** pass `--skip-debug-inject` unless you know you do not need CDP; Core must inject `--remote-debugging-port=<allocated>` for debugging.

**Monorepo developers** may use `yarn oc` as an alias to the workspace CLI; for **agents and end users**, standardize on `**opd`** after npm global install.

---

## Step 2 — Start a session

```bash
opd session start <profileId>
```

Example profile: `doubao-default` if app id was `doubao`.

Wait until state is `**running**`:

```bash
opd session list
```

Note the **session `id`** (UUID).

---

## Step 3 — Resolve a `targetId` (which CDP page to drive)

```http
GET /v1/sessions/<sessionId>/list-window
Authorization: Bearer <token>
```

Response includes `**nodes[]**` with `**targetId**`, `**type**` (e.g. `page`), `**title**`, `**url**`. Pick the **page** that hosts the UI you need (e.g. main chat window).

---

## Step 4 — Call Agent actions (type, click, keys, wait, eval)

Endpoint:

```http
POST /v1/agent/sessions/<sessionId>/actions
Authorization: Bearer <token>
Content-Type: application/json
```

Common `**action**` values:


| `action` | Required fields                    | Notes                                                                                                                       |
| -------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `type`   | `targetId`, `selector`, `text`     | Uses `document.querySelector(selector)` then `Input.insertText`. Needs `allowScriptExecution: true` on the session profile. |
| `keys`   | `targetId`, `key`                  | e.g. `"Enter"` to submit after `type`.                                                                                      |
| `click`  | `targetId`, `selector`             |                                                                                                                             |
| `wait`   | `targetId`, `ms` and/or `selector` | Wait before scraping a reply.                                                                                               |
| `eval`   | `targetId`, `expression`           | `Runtime.evaluate` in page; use to read DOM text. Needs script permission.                                                  |


**Payload safety:** Avoid hand-building JSON in shells (quotes and Unicode break on Windows). Prefer:

- A `**body.json`** file and `**curl`**:

```bash
curl -s -X POST "http://127.0.0.1:8787/v1/agent/sessions/<sessionId>/actions" \
  -H "Authorization: Bearer <paste-token-here>" \
  -H "Content-Type: application/json" \
  --data-binary @body.json
```

- Or any HTTP client (scripting language, GUI client) that sends valid JSON.

Example `body.json` for typing then you send a second request for `"action":"keys","key":"Enter"`:

```json
{
  "action": "type",
  "targetId": "<targetId>",
  "selector": "textarea",
  "text": "Hello. Who are you?"
}
```

---

## Step 5 — Read the assistant reply (scraping)

There is no single “get last message” API. Practical approach:

1. `wait` with `**ms**` (e.g. 15000–30000) for LLM latency.
2. `eval` with an `**expression**` that returns a string or JSON-serializable object, e.g. tail of `document.querySelector("main")?.innerText` or a more specific selector if you know the app’s DOM.

Expect **noise** in `innerText` (sidebars, buttons, old messages). Quote the **new** paragraph for end users.

---

## Optional — CDP proxy URL (Playwright, DevTools)

Core exposes a **WebSocket/HTTP proxy** to the session’s debug port:

```text
http://127.0.0.1:<corePort>/v1/sessions/<sessionId>/cdp
```

Use the **full path** as the `connectOverCDP` endpoint (not only `host:port`), so `/json/version` resolves correctly.

**Accessibility vs full DOM (Playwright over CDP):** If you attach with `**connectOverCDP`** (same gateway URL as above), prefer `**page.locator('body').ariaSnapshot()`** (compact YAML from the **accessibility tree**) when you need to **locate or reason about elements**—it is typically **much faster** than pulling and analyzing a **full DOM** (e.g. large `outerHTML`). For agents that **do not** use Playwright, stay portable with `**opd`** + Agent `**eval`** as in the steps above. **结论（仓库内实验结论）：** 用 `body.ariaSnapshot()` 通过无障碍信息识别元素，通常比分析完整 DOM 快得多。

---

## Troubleshooting (for agents)


| Symptom                                                 | Likely cause                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opd: command not found`                                | Run `npm install -g @hanzhao111/opendesktop` and ensure npm global `bin` is on `PATH`.                                                                                           |
| Session `failed`, `child exited during startup: code=0` | Wrong `exe` (launcher exits), or **single-instance** app delegated to an already running process. Fully quit the app, or register the true Electron binary (often under `app\`). |
| `SESSION_NOT_FOUND` on CDP URL                          | Stale session id; start a new session.                                                                                                                                           |
| `TYPE_FAILED` / `type_no_element`                       | `selector` does not match; try `textarea`, `[contenteditable="true"]`, or inspect with `eval`.                                                                                   |
| Empty logs in export                                    | Process exited before emitting stderr; check registration path and singleton behavior.                                                                                           |


---

## Security reminder

Core is **local trust**: Bearer protects HTTP APIs; CDP proxy is **high privilege** (script, navigation). Do not expose Core to untrusted networks.

---

## Versioning

When you copy this file out of the **openDesktop** repo, note the **Core / `opd` version** (`opd --help` or npm show `@hanzhao111/opendesktop` version) if behavior drifts.