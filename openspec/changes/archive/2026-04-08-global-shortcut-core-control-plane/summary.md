# global-shortcut-core-control-plane

## 概述

**一句话**：全局快捷键闭集动作改为 **Electron 主进程直连 Core HTTP 控制面** 执行业务（矢量录制启停、打点等），核心逻辑集中在 Core，Studio Web 不再作为业务必经路径，便于第三方客户端复用。

**背景与动机**：当前链路依赖 preload → Web → `fetch` Core，易受 React 挂载、IPC 订阅与 token 状态影响；且第三方壳无法复用同一语义。将控制面上移到 Core 后，任意持有 Bearer 的客户端均可一致调用。

**影响范围**：`packages/core`（新路由与编排）、`packages/studio-electron-shell`（主进程 HTTP 调用、`sessionId` 来源）、`packages/web`（移除重复业务 handler）、文档。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件（预期） |
|---|------|------|------------------|
| 1 | Core 控制面 `POST .../control/global-shortcut` | 闭集 `actionId` + 会话内编排既有录制/打点 | `packages/core/src/http/createApp.ts` 等 |
| 2 | 主进程快捷键 → `fetch` Core | Bearer + base URL + body（含 `sessionId`、target 策略） | `packages/studio-electron-shell/src/main.js` |
| 3 | Web 去业务双路径 | 保留快捷键配置 UI；删除/禁用 `handleGlobalShortcutAction` 内 Core 调用 | `packages/web/src/App.tsx`、`preload` 可选精简 |
| 4 | 文档 | 架构说明与第三方调用方式 | `docs/studio-shell.md` |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|-------------------|
| API 形态 | 单会话单端点 + `actionId` | 避免每动作一个路由，扩展成本高 |
| 业务实现位置 | Core 内 switch/表驱动调用既有服务 | 避免与现有 `recording/start` 行为漂移 |
| `sessionId` 来源 | 请求路径参数 + 主进程 store（Web IPC 同步或显式配置） | 无 Web 时需显式会话上下文 |

### 技术细节

1. **请求**：`Authorization: Bearer`；`POST /v1/sessions/:sessionId/control/global-shortcut`；body：`{ "actionId": "vector-record-toggle", "targetIds"?: [...] }`（字段以实现为准）。
2. **响应**：整体或逐项 `results[]`，含 `targetId`、`ok`、`error`/`code`，支持部分失败与 `207`（若采用）。
3. **主进程**：在现有 `globalShortcut.register` 回调中组装 JSON 并 `fetch`；`sessionId` 由设计 D3 选定策略提供。
4. **Web**：仅 `localStorage` 同步 accelerator 到主进程；不再依赖 `onGlobalShortcutAction` 做 `start/stop`。

## 验收标准

> 测试和产品验收以本节为准（源自 specs）。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 合法控制面调用 | 有效 Bearer + 存在会话 + 已知 `actionId` | Core 返回 2xx，body 含结构化结果，业务效果发生 |
| 2 | 鉴权失败 | 无 Bearer 或无效 token | 401，不修改录制状态 |
| 3 | 未知 actionId | body 中 `actionId` 非法 | 400 + 可机读错误，不执行业务 |
| 4 | 批量 target 部分失败 | 多 target 启动遇并行上限 | 响应逐项标明失败；已成功项保持录制 |
| 5 | 与单 target API 一致 | 与直接 `recording/start` 对比同一会话 target | 最终状态等价（幂等策略一致） |
| 6 | Electron 主路径 | 按快捷键 | 主进程调 Core，不依赖 Web 已订阅 IPC |
| 7 | Web 未加载 | 无 Studio 页 | 在会话/target 前提满足时快捷键仍可执行业务 |
| 8 | 与按钮对齐 | 快捷键 vs Studio 按钮（同状态） | 行为一致（含错误语义） |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | Core 控制面 API | 路由 + 编排 + 测试 | — |
| 2 | 主进程 HTTP | 快捷键回调调 Core + sessionId 策略 | Task 1 |
| 3 | Web 精简 | 去掉业务重复路径 | Task 1–2 |
| 4 | 文档与回归测试 | studio-shell + yarn test | Task 1–3 |

## 测试要点

- Core：鉴权、闭集、`207`/逐项错误、与现有 `recording/start` 幂等行为对齐。
- Shell：无 Web 时仍能 `fetch`（mock Core）；无双重 `start`。
- Web：配置绑定仍同步主进程；无重复 `fetch` 录制接口。
