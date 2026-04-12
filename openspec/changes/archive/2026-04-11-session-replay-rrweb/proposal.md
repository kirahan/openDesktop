## Why

现有「矢量会话」路径以 `innerText` 类文本 digest 与指针坐标为主，无法还原 **带布局的页面骨架**，与 Sentry Session Replay 等产品的可调试体验差距大。业界成熟做法是采用 **rrweb** 在页面内录制 DOM 快照与增量变更，在调试端用 **Replayer** 重放。OpenDesktop 已具备 CDP 注入与 Bearer 管道，适合新增一条 **rrweb 事件流 + 同屏回放** 能力；同时把录制端打成 **通用 `inject.bundle.js`**，便于不仅随「开启录制」自动注入，也在 Studio **一键手动注入** 到当前 page target，提升可复用性与排障灵活性。

## What Changes

- **构建物**：新增（或纳入构建管线）**通用注入包** `inject.bundle.js`（IIFE/单文件，内含 `@rrweb/record` 启动逻辑与可配置项如隐私、采样开关），版本与 Core/Web 的 **Replayer** 所用 `@rrweb/replayer` **主版本对齐**。
- **采集与传输**：在 `allowScriptExecution` 且附着到目标 `page` 时，通过 **CDP `Runtime.evaluate`**（或与现有 UserScript 注入路径一致）注入上述 bundle；rrweb 产生的事件经 **既有或新增** 通道送达 Core（例如扩展现有 CDP `Runtime.addBinding` 管道或独立 binding 名），再经 **鉴权 SSE/Web** 推送至 Studio。
- **回放 UI**：在 Web 侧使用 **`@rrweb/replayer`**（或 `rrweb-player` 再定制）在 **同一视口区域** 重放 DOM，**指针/点击 overlay** 与回放层 **叠在同一画布容器**（z-index 与时间轴对齐策略见 design）。
- **Studio 交互**：在合适位置（例如拓扑页目标卡片或实时观测区）增加 **「注入 rrweb 录制包」** 按钮：调用 Core 已有或新增的「对指定 sessionId+targetId 注入脚本正文」能力，**脚本来源为内置/打包的 `inject.bundle.js`**，无需用户粘贴；与「自动随会话开启注入」**可并存**，具体默认策略见 design。
- **隐私与安全**：默认启用 rrweb 侧 **文本/输入类脱敏**（与产品文档一致）；全量内容不落第三方，默认本地或会话内流式处理。

**非目标（第一期可排除或显式延后）**：与现有纯文本 `structure_snapshot` 流完全合并为一种协议（可先并存）；跨域 iframe 内文档的完整 rrweb 录制；主进程非 web 内容录制。

## Capabilities

### New Capabilities

- `session-replay-rrweb`：定义 rrweb 注入包形态、手动与自动注入入口、rrweb 事件到 Core 的传输与鉴权、Studio 侧 Replayer 与指针同屏的最低行为，以及隐私默认值。

### Modified Capabilities

- （无）不在本变更中修改已归档 spec 的既有 REQUIREMENTS 段落；与 `page-session-replay`（若已归档）及 `studio-live-console` 相邻，通过新 capability 描述增量行为，避免在未归档合并前误改主 spec。

## Impact

- **依赖**：新增 `rrweb` 生态依赖（`@rrweb/record`、`@rrweb/replayer` 等，确切包名与版本在 design 锁定）；需 **构建步骤** 产出 `inject.bundle.js`（esbuild/rollup 等）。
- **packages/core**：扩展或新增注入与事件转发路由；限流、会话生命周期与现有 observability 对齐。
- **packages/web**：Replayer 容器、时间轴/指针对齐（若一期仅实时流可简化）、**注入按钮** 与 API 调用。
- **安全与合规**：录制数据可能含页面文本与结构，须在 design 与 spec 中约定默认脱敏与本地性说明。
