## 1. 根 README 与入口互链

- [x] 1.1 收紧根目录 `README.md`：保留快速上手与关键示例，将冗长 CLI 细节改为指向 `docs/CLI.md`（实现后路径）与 `docs/PRODUCT.md`
  - [x] Test: 对照 `specs/project-documentation/spec.md` 中「根目录英文 README」「文档目录可发现性」场景手工验收并勾选
- [x] 1.2 新增 `README_CN.md`：与英文 README 章节对齐，文首互链 `README.md`
  - [x] Test: 对照 spec 中「中文入口 README」场景手工验收（链接可点、步骤完整）

## 2. CLI 与产品文档

- [x] 2.1 新增 `docs/CLI.md`：从 `packages/core/src/cli.ts` 与 `od --help` 整理命令树、全局选项、App-first、退出码摘要；文首写明以源码与 help 为准
  - [x] Test: 抽样比对 `yarn workspace @opendesktop/core cli -- --help` 与文档中的顶层命令列表（至少覆盖 core、app、profile、session、doctor）
- [x] 2.2 更新 `docs/PRODUCT.md`：增加「规格 vs 操作手册」说明段；修复损坏的表格行
  - [x] Test: 在本地 Markdown 预览中确认表格渲染完整；对照 spec「产品总览与操作手册分工」场景

## 3. 交叉引用与包级 README

- [x] 3.1 在根 `README.md` 与 `README_CN.md` 中增加 `docs/` 导航段（链到 `docs/CLI.md`、`docs/PRODUCT.md`）
  - [x] Test: 相对路径在 GitHub 或本地预览中可跳转
- [x] 3.2 评估并更新 `packages/web/README.md`：与根文档互链（Studio 或 Web UI 说明），避免矛盾表述
  - [x] Test: 通读 Web 包 README 与根 README 中关于 token 与同源描述，无冲突

## 4. 可选扩展（本 change 内按需完成）

- [x] 4.1 （可选）新增 `docs/API.md`：Control API 速查表，链到 `openspec/specs` 相关 capability
  - [x] Test: 抽样核对一条 HTTP 路径与 `packages/core` 路由注册或现有规格一致
- [x] 4.2 （可选）在根 `package.json` 增加文档链接检查脚本并在 CI 调用
  - [x] Test: 故意断链时脚本能失败（若实现该脚本）
