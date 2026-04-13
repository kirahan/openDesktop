## 1. 数据模型与持久化

- [x] 1.1 在 `AppDefinition` 增加 `**uiRuntime?: "electron" | "qt"**`（缺省按 `electron` 读写兼容），更新 `STORE_SCHEMA_VERSION` 若项目要求迁移钩子。
- [x] 1.2 `GET/POST /v1/apps` 序列化与校验 `uiRuntime`；非法值 **400**。

## 2. 会话列表聚合

- [x] 2.1 `GET /v1/sessions` 每条会话增加 `**uiRuntime`**（由 profile → app 解析），缺省 **electron**。

## 3. nut-js 与鼠标坐标

- [x] 3.1 在 `**packages/core/package.json`** 增加 `**@nut-tree/nut-js`** 依赖；文档说明 **授权/预编译** 注意点。
- [x] 3.2 封装 `**getGlobalMousePosition()`**：darwin 调 `mouse.getPosition()`；失败抛/返回可映射错误（供 `**MOUSE_POSITION_UNAVAILABLE`**）。
- [x] 3.3 单元测试：**mock** nut-js，覆盖成功与失败分支（不在 CI 真机依赖鼠标）。

## 4. macOS AX 按点采集（Swift）

- [x] 4.1 扩展 `**native-macos/`**：对给定 pid + 屏幕坐标 调用 `**AXUIElementCopyElementAtPosition**`（或等价），实现 **命中节点 + 祖先链 + 受限子树**，输出与整树 **兼容** 的 JSON 节点形态。
- [x] 4.2 支持 `**maxAncestorDepth` / `maxLocalDepth` / `maxNodes`** 与 `**truncated`**；错误码与整树对齐（含 `**ACCESSIBILITY_DISABLED**`）。

## 5. HTTP 与 version

- [x] 5.1 新增 `**GET /v1/sessions/:sessionId/native-accessibility-at-point**`（或项目约定路径）：Query `**x`/`y**` 可选；无则走 nut-js；校验 **running + pid**。
- [x] 5.2 `**GET /v1/version`**：`capabilities` 增加 `**native_accessibility_at_point`**（仅 darwin）。
- [x] 5.3 `***.http.test.ts**`：mock Swift 子进程与 mouse 模块，覆盖 **403/404/400**、成功路径、**无坐标且 mouse 失败**。

## 6. 文档

- [x] 6.1 更新 `**docs/API.md`**：新路由、参数、错误码、nut-js 与 **辅助功能** 说明。

## 7. Studio Web

- [x] 7.1 应用列表：**Electron / Qt** 标签（读 `GET /v1/apps`）。
- [x] 7.2 注册/编辑应用：可选 `**uiRuntime`**（下拉 **Electron / Qt**），默认 Electron。
- [x] 7.3 **会话观测分流**：`uiRuntime === "electron"` 保持现有卡片；`**qt`** 仅突出 **整树** + **鼠标周围** 两主按钮（复用/扩展 `MacAxTreeVisual`）。
- [x] 7.4 轻量测试：`uiRuntime` 与按钮可见性逻辑（Vitest）。

## 8. 回归

- [x] 8.1 `packages/core` `**yarn test**`；`packages/web` `**yarn test**` 通过。
