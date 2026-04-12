# @opendesktop/web

OpenDesktop 控制台前端（Vite + React）。仓库总览、启动 Core、token 与文档导航见根目录 [README.md](../../README.md)。

## 矢量录制与落盘（实时观测抽屉）

- **协议与字段**：`replay/recording/start|stop`、`replay/stream`、可选 **`injectPageControls`**、**`assertion_checkpoint`** 等以 Core [`docs/API.md`](../../docs/API.md) 为准。
- **页面内控制条**：开启「注入控制条」时，开始录制请求会带 **`injectPageControls: true`**，页面内可停止录制或打检查点；控制条上的指针事件不会进入矢量 NDJSON。
- **落盘测试录制**：将当前 **矢量** 标签内已累积的行提交为 `test-recording-*.json`。缓冲区在同标签内 **多次开始/停止会追加** 行，需只分析本轮录制时可先 **清屏** 再录。
- **按段多文件**：当 NDJSON 中存在成对的 **`segment_start`** 与 **`segment_end`** 时，控制台**仅将每个闭合区间**（含起止两行）分别 **POST** 一次 `test-recording-artifacts`（每次可带不同 **`recordingId`**）；段前与段后游离的采样行不会单独成文件。无分段标记时仍为单次落盘。详见 [`docs/API.md`](../../docs/API.md) 应用侧 JSON 说明。

## Network 视图与第三方 UI 参考

**HTTPS / 主进程代理** 观测在 **实时观测抽屉** 中展示表格布局，**信息架构** 参考开源项目 **[Whistle](https://github.com/avwo/whistle)**（Copyright avwo，**MIT License**）。实现为自有 React 组件，非嵌入 Whistle 构建产物。

## 本地转发代理（主进程 HTTP(S)）

- **Core**：`GET /v1/sessions/:sessionId/proxy/stream`（SSE，`proxyRequestComplete` 事件）。首期 **不对 HTTPS 做 MITM**，CONNECT 隧道事件带 `tlsTunnel: true`。
- **固定代理端口（联调）**：启动 Core 前设置 `OPENDESKTOP_LOCAL_PROXY_PORT=62266`（示例），则专用代理固定监听该端口，便于与应用内写死的代理地址对齐；**勿**多会话同时占用同一端口。
- **已注册应用**：表格中 **「专用代理」** 勾选后，**下次启动会话** 时为子进程注入 `HTTP_PROXY`/`HTTPS_PROXY`（及 `NO_PROXY`，含 Core 端口），**非系统全局代理**。
- **应用自带代理**：部分 **Electron 等桌面应用**在进程内单独配置代理（或经 Chromium 网络栈），可能 **覆盖或忽略** 上述环境变量，导致 **主进程代理流无流量**。此时可二选一：**改用操作系统全局代理** 并指向同一本机端口，或 **在该应用设置中** 将 HTTP/HTTPS 代理设为与本机转发代理一致（例如 `127.0.0.1:<端口>`，可与 `OPENDESKTOP_LOCAL_PROXY_PORT` 对齐）。
- **Phase 2（MITM 解密）**：见 `openspec/specs/local-forward-proxy/spec.md` 占位说明；历史任务见 `openspec/changes/archive/2026-04-10-local-forward-proxy-observability/tasks.md` §7。

## 开发

```bash
yarn dev
```

默认通过 Vite 代理将 `/v1` 转发至 `http://127.0.0.1:8787`（需已启动 Core）。

## 测试

```bash
yarn test
```

### 手动验收（代理）

1. Core 运行，`packages/web` 填好 Token。
2. 在已注册应用中勾选 **专用代理**，保存后 **新建会话**（或重启会话）使环境变量生效。
3. 在窗口卡片中点击 **打开主进程代理流**，表格 **Src** 列应出现 `proxy` 行（子进程有出站请求时）。

若始终无 `proxy` 行，先确认子进程确有出站 HTTP(S)；仍无则见上文 **应用自带代理**（全局代理或应用内代理指向本机转发端口）。