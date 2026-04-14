## Context

- 现状：主进程 `globalShortcut` → `webContents.send("od:global-shortcut")` → preload → Web `handleGlobalShortcutAction` → `fetch` Core。业务与 **Studio 是否打开、React 是否订阅** 耦合。
- 目标：与 **openspec/changes/global-shortcut-core-control-plane/proposal.md** 一致，使 **闭集快捷键动作** 的规范路径为 **主进程 → Core HTTP**，Core 内完成录制启停与打点编排。
- 约束：沿用现有 **Bearer** 鉴权；不修改鉴权/加密红线模块本身（仅调用既有 HTTP 中间件）。

## Goals / Non-Goals

**Goals:**

- Core 暴露 **单一、可测试** 的控制面入口（或少量正交路由），将 `actionId` 映射到内部服务调用。
- Electron 主进程在快捷键回调中 **仅依赖** token + Core base URL + `sessionId`/target 策略（见下），**不依赖** Web。
- 未来新增闭集动作时，**优先**在 Core 增加分支 + 主进程映射表，Web 可不改动。

**Non-Goals:**

- 重新定义用户可配置的 accelerator 格式（仍由 Web → 主进程同步）。
- 在本变更中实现 **非 Electron** 的全局系统热键（仍仅 Electron `globalShortcut`）。
- 替换现有 `POST .../replay/recording/start` 单 target API（可保留，控制面内部复用）。

## Decisions

### D1：控制面形态 — 专用路由 vs 单端点

- **选择**：提供 **`POST /v1/sessions/:sessionId/control/global-shortcut`**（名称可微调，以实现对齐为准），body 含 **`actionId`**（闭集枚举字符串）及文档化可选字段（如 `targetIds`、`injectPageControls` 覆盖、`mode`）。
- **理由**：单会话作用域与现有 `replay/recording/*` 一致；主进程天然持有或可从配置读取 **当前工作 `sessionId`**（见 D3）。第三方客户端只需拼路径 + Bearer。
- **备选**：每动作独立路由（`/.../vector-toggle`）— 拒绝，扩展动作时路由爆炸。

### D2：Core 内编排

- **选择**：handler 内 **`switch(actionId)`**（或表驱动）调用现有 `startPageRecording` / `stopPageRecording` / `emitPageRecordingStudioUiMarker` / markers 等，**禁止**复制业务逻辑。
- **理由**：单一真相来源，便于测试与审计。

### D3：`sessionId` 与 target 集合来源

- **选择**：请求 **必须**带路径参数 `sessionId`；**target 列表** 规则在 spec 中写死两种之一（实现二选一并文档化）：
  - **A**：body 可选 `targetIds: string[]`；若省略则 Core 从 `manager.getOpsContext(sessionId)` 下列出 **可脚本执行的 page target**（或会话已注册 target 列表，以实现为准）；
  - **B**：body **必须** `targetIds`，由主进程在调用前从持久化/上次 Web 同步的 IPC 写入主进程 store 读取。
- **开放**：实现阶段在 tasks 中择一；若 A 需 Core 已有拓扑枚举能力，优先复用现有 CDP/session API。

### D4：Electron 主进程如何拿 Bearer 与 base URL

- **选择**：复用现有 **`od:read-core-bearer-token`**（或等价）与 **Core 监听地址**（环境变量 / 与加载 Web 时一致的主进程常量）。
- **理由**：与今日 Studio 填 token 同源，避免双 token。

### D5：Web 遗留路径

- **选择**：实现后 **默认关闭** Web 内对同一动作的 Core `fetch` 业务路径，或 gated by feature flag；**可保留** IPC 仅用于 UI 刷新（可选）。
- **理由**：避免双路径双次 `start`。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 主进程不知 `sessionId` | 设计「当前会话」同步：由 Web 在用户选定会话时 IPC 写入主进程 store；或要求快捷键仅在有显式 `sessionId` 配置时生效（MVP）。 |
| 与旧 preload 双订阅 | 实现时移除 Web handler 或主进程不再 `send` 到 renderer（二选一并写入 tasks）。 |
| 批量 start 部分失败 | API 返回 **逐项** `ok`/`error`，主进程打日志；与 `PARALLEL_LIMIT_EXCEEDED` 对齐。 |

## Migration Plan

1. 实现 Core API + 测试。
2. 主进程改调 Core；特性开关下可回退 `send` 到 renderer。
3. Web 删除冗余业务代码；文档更新 `docs/studio-shell.md`。

## Open Questions

- 「当前 `sessionId`」在无 Web 时默认值（若 CLI 仅开 Core）：是否要求控制面 **必须**显式传 `sessionId`（推荐），不提供默认。
