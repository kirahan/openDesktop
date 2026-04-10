## Context

- OpenDesktop 已通过 CDP 附着 **`page` target**，具备 `Runtime.evaluate`、`DOM.getDocument` 等能力（见 `packages/core/src/cdp/browserClient.ts`）。
- 会话具备 **`allowScriptExecution`** 与 **`running` + `cdpPort`**，与既有 Agent 脚本类动作门禁一致。
- 本 spike **不**依赖修改被测应用源码或 preload；注入 **仅通过 CDP** 下发的字符串完成。

## Goals / Non-Goals

**Goals:**

- **方案 1（注入）**：在目标 **document** 上安装 **捕获阶段** 指针监听，将最近一次点击的 **`clientX` / `clientY`**（及时间戳，可选）写入 **固定全局键**（例如 `window.__odDomPickLast`），供后续 `Runtime.evaluate` 读取。
- 在同一 **target session** 上调用 **`DOM.getNodeForLocation`**（参数 `x`, `y` 与 DevTools 文档一致，通常为 **CSS 像素/layout 坐标**），取得 `backendNodeId` / `nodeId`；再调用 **`DOM.describeNode`**（或 `DOM.getOuterHTML` 限长）得到人类可读摘要。
- API 形态：**arm**（幂等：重复 arm 可刷新监听器）与 **resolve**（读 stash → CDP → 返回 JSON；**可选**清空 stash 以免重复提交）。
- **单 Electron 进程、单 `page` target**：调用方在 URL 中传入 **`targetId`**（与现有 `list-window` / 观测一致）。

**Non-Goals:**

- macOS / Windows **全局**鼠标钩子、无障碍权限链路。
- **跨 iframe** 自动选对 frame（首期可文档化：仅主 frame 文档坐标；若点在 iframe 内需后续变更）。
- Playwright 级 **selector 稳定性**（`data-testid` 链路等）。
- 自动 **arm** 后阻塞直到点击（长连接）；首期用显式 **resolve** 即可。

## Decisions

### 1. 全局 stash 键名

- **选择**：固定命名空间键，例如 `window.__odDomPickLast = { x, y, ts }`（字段名以最终实现为准），**仅**在注入脚本与 Core 读取逻辑中约定。
- **理由**：最短路径，无需额外 IPC；后续可改为 `sessionStorage` 或 postMessage 若与安全策略冲突。

### 2. 注入正文

- **选择**：`Runtime.evaluate` 注入 **IIFE**，内部 `document.addEventListener('pointerdown', handler, true)`（或 `click`），`preventDefault` **不**调用，避免破坏站点；仅 `stopPropagation` **不**使用，以免改变站点行为——若发现与页面冲突，可在 tasks 中改为仅 `capture` 记录坐标不干预默认行为。
- **理由**：`pointerdown` 早于 `click`，略贴近「取点」语义。

### 3. CDP 调用顺序

- **选择**：`attachToTarget` → `DOM.enable` → （必要时 `Runtime.enable`）→ 注入 arm → 用户操作 → **resolve**：`Runtime.evaluate` 读 stash → 若缺省则 4xx → 若有则 `DOM.getNodeForLocation({ x, y })` → `DOM.describeNode`。
- **理由**：与 Chrome DevTools 域依赖一致。

### 4. 坐标系

- **选择**：使用注入事件中的 **`clientX` / `clientY`** 作为 `getNodeForLocation` 输入；在 **design / README** 中注明与 **滚动、`devicePixelRatio`** 的潜在偏差（spike 以「同窗口内点选」通过为主）。

### 5. API 形状（建议）

- `POST /v1/sessions/:sessionId/targets/:targetId/dom-pick/arm` — Body 可选 `{}`；成功 **200**。
- `POST /v1/sessions/:sessionId/targets/:targetId/dom-pick/resolve` — 成功 **200**，Body 含 `node` 摘要；若无 stash 则 **400** `DOM_PICK_EMPTY`（或等价）。

路径以实现为准，须 **Bearer**。

## Risks / Trade-offs

- **[Risk] 页面 CSP 禁止 `eval` 类执行** → `Runtime.evaluate` 可能失败；arm 返回可机读错误。
- **[Risk] 页面重载导致监听器丢失** → 需重新 arm；文档说明。
- **[Trade-off] 与 `explore` 并存** → 不同入口；本能力强调 **用户点击位置**。

## Migration Plan

- 新增路由与模块；无数据迁移。

## Open Questions

- resolve 是否 **默认清空** stash（建议 **是**，避免二次误用）。
- `describeNode` 返回字段子集：优先 `nodeName`、`attributes`、`nodeId`，避免超大 HTML。
