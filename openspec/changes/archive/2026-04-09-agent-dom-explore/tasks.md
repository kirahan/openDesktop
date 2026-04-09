## 1. 纯函数与单测（无 CDP）

- [x] 1.1 在 `packages/core` 新增模块：输入 HTML 字符串与选项（`maxCandidates`、是否包含类链 `a` 等），输出 `candidates[]`（`label`、`selector`、`score`、`reasons` 等与 design 一致）
  - [x] Test: Vitest 单测，fixture 覆盖：`<button>` 文本、`role="button"`、`input[type=submit]`、`disabled` 排除、空列表、超上限截断与稳定排序（对齐 spec：确定性）
- [x] 1.2 引入或复用 HTML 解析依赖（与设计一致，如 cheerio），保持仅 Node 解析、不执行脚本

## 2. Agent HTTP 集成

- [x] 2.1 在 `agentActionAliases.ts` 将 `explore` 加入 `SUPPORTED_AGENT_ACTIONS`；在 `registerObservability`（或现行分发处）实现 `explore`：复用与 `get` 相同的 DOM 拉取，再调用 1.1 纯函数组装 JSON
  - [x] Test: 扩展 `createApp.test.ts` 或 `agentActions.http.test.ts`：mock DOM 返回固定 HTML，断言 `action: explore` 响应含 `candidates`；断言 `GET /v1/version` 的 `agentActions` 含 `explore`
- [x] 2.2 错误路径与 `get` 对齐（无效 session/target、DOM 失败），响应可机读

## 3. 文档

- [x] 3.1 更新根目录 `README.md` Agent 动词表：`explore`、参数说明、与 `get`/`click` 的组合关系
  - [x] Test: 无强制；可选断言 README 片段存在（若项目无此类测试则跳过）

## 4. 回归

- [x] 4.1 在 `packages/core` 执行 `yarn test` 全部通过
  - [x] Test: 同上作为收尾门槛
