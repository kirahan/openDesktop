## 1. Core：注入管线与 CDP

- [x] 1.1 实现「按 `appId` 列出脚本并取出解析后的 `body`」的纯函数或内部服务（复用 `parseUserScriptSource` / 存储记录中的快照，顺序规则见 `design.md`）
- [x] 1.2 在 `browserClient`（或并列模块）中实现：连接会话 CDP → `Target.getTargets` → 筛选 `type === "page"` → 对每个 target 调用 `Runtime.evaluate`（或封装）注入单条 body；汇总 per-target 错误
- [x] 1.3 将 `allowScriptExecution === false`、会话状态非 `running`、CDP 失败映射为文档化 HTTP 错误（与既有 `SCRIPT_NOT_ALLOWED` 等一致）

## 2. Core：HTTP API

- [x] 2.1 在 `createApp.ts`（或等价路由注册处）注册 **POST** `/v1/sessions/:sessionId/user-scripts/inject`（路径以最终实现为准，须 Bearer），绑定会话 → Profile → `appId`，调用 1.x 注入管线
- [x] 2.2 定义响应 JSON：`injectedScripts`/`targets` 计数与可选 `errors[]`（形状在实现与测试中定死一种）
- [x] 2.3 新增 `*.http.test.ts`：覆盖 403（`allowScriptExecution: false`）、非 running、无脚本 2xx、成功路径（可用 mock CDP 或项目既有模式）

## 3. 文档

- [x] 3.1 更新根 `README.md` 用户脚本小节：显式注入 API、`@match` 不参与注入、多 target 重复执行提示

## 4. Studio（可选）

- [x] 4.1 在 `packages/web` 会话详情（或应用卡片上下文）增加「注入用户脚本」按钮，调用新 API 并展示成功/失败摘要（若本迭代不做，在本 task 标记取消并在 `summary.md` 注明延后）

## 5. 规格合并准备

- [x] 5.1 Apply 完成后执行 `openspec reconcile` 或手工将 `specs/app-user-scripts/spec.md` delta 合并入 `openspec/specs/app-user-scripts/spec.md`（按项目归档流程）
