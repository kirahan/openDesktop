## 1. UserScript 元数据解析

- [x] 1.1 实现 `// ==UserScript==` … `// ==/UserScript==` 块解析，抽取 `@name`、`@namespace`、`@version`、`@description`、`@author`、多条 `@match`、`@grant`
- [x] 1.2 校验：`@grant` 仅允许 `none`（或缺省视为 `none`）；其它 grant 值返回明确错误
- [x] 1.3 将 `@match` 全部原样写入 `matches: string[]`（不编译、不用于 URL 判断）
  - [x] 测试：`packages/core/src/.../userScriptMetadata*.spec.ts` 或并列 `__tests__/`，覆盖多条 `@match`、非法 `@grant`、缺 `@name`

## 2. 按 app 持久化

- [x] 2.1 定义存储 schema（脚本 id、appId、source 全文、解析后的 metadata 快照、更新时间），落盘位置与现有 `dataDir`/JsonStore 模式对齐（见 design）
- [x] 2.2 实现按 `appId` 的列表 / 单条读 / 写 / 删
  - [x] 测试：存储层单元测试或 HTTP 集成测试覆盖 CRUD 与 app 隔离

## 3. HTTP API（Core）

- [x] 3.1 注册鉴权后的管理路由（路径以最终实现为准，须与 `design.md` 一致），请求体携带完整 `.user.js` 源文或等价字段
- [x] 3.2 创建/更新时服务端解析；失败时 4xx + 可机读 `code`；成功时返回持久化记录（含 `matches` 数组）
- [x] 3.3 **不**实现：基于 URL 或 `@match` 的过滤、自动注入、与 CDP 会话绑定
  - [x] 测试：`*.http.test.ts` 或 supertest，覆盖成功创建、列表、`@grant` 非法、多 `@match` 入库

## 4. 文档与回归

- [x] 4.1 README 或 OpenCLI 片段：说明「`@match` 已存储但当前不用于匹配」及 SPA 限制指向 `design.md`
- [x] 4.2 确认无新增「误用 match 自动执行」的代码路径（静态自查或轻量测试）
