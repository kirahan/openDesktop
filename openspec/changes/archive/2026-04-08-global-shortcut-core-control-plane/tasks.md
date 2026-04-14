## 1. Core 控制面 API

- 1.1 在 `packages/core` HTTP 层实现 `POST /v1/sessions/:sessionId/control/global-shortcut`（路径以实现与 `design.md` 最终定名为准），校验 Bearer、`sessionId`、`actionId` 闭集
- 1.2 在 handler 内编排：对 `vector-record-toggle` / `segment-*` / `checkpoint` 调用既有 `startPageRecording`、`stopPageRecording`、`emitPageRecordingStudioUiMarker` 或等价服务；支持批量 target 与逐项结果（对齐 `PARALLEL_LIMIT_EXCEEDED`）
- 1.3 定义 `targetIds` 省略时的解析规则（`design.md` D3 择一）并在代码注释与 OpenSpec 归档时一致
- 1.4 单元测试：`createApp.test.ts` 或专用测试覆盖鉴权、未知 `actionId`、部分失败响应结构

## 2. Electron 主进程

- 2.1 `packages/studio-electron-shell`：`globalShortcut` 回调改为 `fetch` Core 控制面（解析 `apiRoot` 与 Bearer，与现有 `od:read-core-bearer-token` / 环境变量对齐）
- 2.2 主进程持久化或 IPC 同步 **当前 `sessionId`**（若 D3 需 Web 写入）；快捷键触发时组请求体
- 2.3 移除或降级向 `webContents.send("od:global-shortcut")` 的业务依赖（可保留空 IPC 仅供调试）；避免双路径双次执行

## 3. Studio Web

- 3.1 移除或禁用 `App.tsx`（`LiveConsoleDockLayout`）内对闭集动作的 **业务级** `fetch` 与 `handleGlobalShortcutAction` 重复逻辑；配置面板 `setGlobalShortcutBindings` 保留
- 3.2 若需 UI 同步：可选订阅 Core 状态或主进程 IPC，不执行业务 `start/stop`

## 4. 文档与回归

- 4.1 更新 `docs/studio-shell.md`：全局快捷键架构（主进程 → Core）；第三方客户端可直调说明
- 4.2 `cd packages/core && yarn test` 与 `cd packages/web && yarn test` 全绿；必要时补充 web 侧删码后的快照/行为测试

