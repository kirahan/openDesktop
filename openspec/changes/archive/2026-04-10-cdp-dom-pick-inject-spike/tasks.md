## 1. CDP 封装

- [x] 1.1 在 `browserClient`（或 `packages/core/src/cdp/domPick.ts`）实现：`attachToTarget` → `DOM.enable` → `DOM.getNodeForLocation` + `DOM.describeNode`（或等价）辅助函数；处理 `getNodeForLocation` 无命中时的错误
- [x] 1.2 实现 **arm** 用 `Runtime.evaluate` 注入 IIFE：捕获阶段监听指针，写入 `window.__odDomPickLast`（字段名与 `design.md` 一致）

## 2. HTTP API

- [x] 2.1 在 `createApp.ts` 注册 `POST .../sessions/:sessionId/targets/:targetId/dom-pick/arm` 与 `POST .../resolve`，Bearer + `getOpsContext` + `allowScriptExecution` 校验
- [x] 2.2 **resolve**：`Runtime.evaluate` 读取 stash → 无则 400 + `DOM_PICK_EMPTY`；有则取节点摘要 JSON；成功后 **清空** stash（文档化）

## 3. 测试与文档

- [x] 3.1 新增 `*.http.test.ts`：403（`allowScriptExecution: false`）、无 stash resolve 4xx；对 CDP 底层可 mock（与 `userScriptInject.http.test` 模式对齐）
- [x] 3.2 README 或 Core 小节：arm → 用户在被测窗口内点击 → resolve；声明单 target spike 限制
