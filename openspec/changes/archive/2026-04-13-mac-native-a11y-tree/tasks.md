## 1. macOS AX 采集核心

- 1.1 在 `packages/core` 增加 macOS 专用模块（如 `src/nativeAccessibility/`）：通过子进程调用 Swift CLI 或等价方式，对给定 **PID** 执行 `AXUIElementCreateApplication` 并递归枚举子元素，序列化为设计文档中的 JSON 形态。
- 1.2 实现 `**maxDepth` / `maxNodes`** 截断与 `**truncated**` 标记；对 AX 错误码区分 **权限拒绝** 与 **其它失败**。
- 1.3 单元测试：对采集逻辑做 **fixture/mock**（mock 子进程 stdout 或抽象端口），覆盖截断与错误映射。

## 2. HTTP 与版本能力

- 2.1 在 `createApp.ts`（或等价路由模块）注册 `GET /v1/sessions/:sessionId/native-accessibility-tree`（或 POST，若需 body —— 以 spec 为准），接入 `authMiddleware`，校验会话 `**running`** + `**pid**`。
- 2.2 将 `**native_accessibility_tree**`（`/v1/version` 的 `capabilities` 字段，仅 darwin 列出）纳入能力声明。
- 2.3 新增 `*.http.test.ts`：403/404/平台不支持、成功路径 mock（与现有 HTTP 测试风格一致）。

## 3. 文档与 Studio Web（必做）

- 3.1 在 `docs/API.md`（或 README 小节）描述接口、查询参数、错误码及 **macOS 辅助功能授权** 说明。
- 3.2 **Studio Web（必做）**：在 `packages/web` 会话观测区增加 **「一键拉取原生无障碍树」** 按钮；当 `GET /v1/version` 声明 `native_accessibility_tree` 可用且当前会话为 `**running`** 时可点；请求 `GET .../sessions/:id/native-accessibility-tree`，将响应以 **树状或可折叠 JSON** 展示；失败时展示 Core 错误信息（含 **403 辅助功能未授权**）。非 macOS 或能力为 false 时按钮 **禁用** 并 `title`/文案说明原因。
- 3.3 Web 侧轻量测试（如有现成 Vitest 模式）：capabilities 为 false 时按钮禁用逻辑，或纯展示组件快照（与项目测试惯例一致）。