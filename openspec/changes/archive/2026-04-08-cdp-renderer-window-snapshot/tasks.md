## 1. CDP 与纯函数

- [x] 1.1 在 `packages/core` 中实现 `collectRendererGlobalSnapshotOnTarget(cdpPort, targetId, opts)`（或等价命名），内部通过 `Runtime.evaluate` + `returnByValue` 执行预置 IIFE，返回 `{ globalNames, entries, interestMatches?, truncated, locationHref?, userAgent? }` 等稳定结构；`opts` 含可选 `interestPattern`、`maxKeys`。
  - [x] Test: 为「生成快照结果的纯逻辑」编写单元测试（mock 无 CDP）：覆盖去重排序、`maxKeys` 截断、interest 过滤、非法正则由调用侧拒绝（若逻辑分层在 Node 侧校验正则）。
- [x] 1.2 在 Node 侧校验 `interestPattern`（长度上限、`new RegExp` try/catch），失败时返回明确错误，不调用 CDP。

## 2. Agent HTTP

- [x] 2.1 在 `agentActionAliases.ts` 的 `SUPPORTED_AGENT_ACTIONS` 中加入 `renderer-globals`，并实现 `registerObservability.ts` 中对该 action 的分发，调用 1.1 的函数，响应 JSON。
  - [x] Test: 扩展 `agentActions.http.test.ts`（或同类），mock CDP/浏览器客户端，断言 `action: renderer-globals` 返回 200 且 body 含快照字段；断言 `GET /v1/version` 的 `agentActions` 含新动词。
- [x] 2.2 确认与 `eval` 相同的 `allowScriptExecution`（或项目现行）校验；若缺失则与本 change 对齐并补测试。

## 3. CLI

- [x] 3.1 在 `packages/core/src/cli.ts` 增加子命令（如 `od agent action <sessionId>`），支持 `--json` body 或从 stdin 读 JSON，调用 `POST /v1/agent/sessions/:id/actions`，stdout 打印响应体。
  - [x] Test: 对 CLI 解析与 URL 拼装做轻量测试（若项目已有 commander 测试模式），或文档化并由 HTTP 集成测试覆盖核心路径。

## 4. 文档

- [x] 4.1 更新根目录 `README.md` Agent 动词表，加入 `renderer-globals` 与参数说明（targetId、interestPattern、maxKeys）。
  - [x] Test: 无强制；可选快照测试 README 片段存在（若项目无此类测试则跳过）。

## 5. 自测

- [x] 5.1 运行 `cd packages/core && yarn test`（或仓库规定的 Core 测试命令），全部通过。
  - [x] Test: 同上为回归门槛。
