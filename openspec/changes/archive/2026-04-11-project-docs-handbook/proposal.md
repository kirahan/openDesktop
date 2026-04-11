## Why

新贡献者与使用者主要依赖根目录 `README.md` 获取安装与 CLI 说明，但单文件已承载过多细节，且缺少中文入口与独立的命令/API 速查；`docs/` 仅存在 `PRODUCT.md`，操作手册与规格总览未分层，维护时易与 `packages/core/src/cli.ts` 行为漂移。需要在仓库层面约定「文档信息架构」与可验收的交付物，降低 onboarding 成本并减少重复叙述。

## What Changes

- 收紧根目录 **英文 README**：保留最短路径（安装、启动 Core、token、一条 demo 路径），将深度内容（完整 CLI 树、退出码表、API 速查等）下沉或链接到 `docs/`。
- 新增 **中文 README**（建议文件名 `README_CN.md`）：与英文 README 结构对齐，面向中文读者；技术细节通过链接复用 `docs/` 与英文段落，避免三处全文重复。
- 在 **`docs/`** 下新增子文档，至少包含：**CLI 手册**（命令树、全局选项、App-first 规则、与 `od --help` 一致）、可选 **API 速查**（鉴权、`/v1` 分组、与 Control API 规格对齐）、可选 **开发指南**（workspace、构建与测试命令）；根 README 与 `packages/web/README.md` 通过链接互指。
- 修正或补全 **`docs/PRODUCT.md`** 中已损坏的表格或断行（若仍存在），并在文首说明与操作手册的分工。
- **不**改变 Core、Web 或 CLI 的运行时行为（本变更以文档与仓库内规格为主）。

## Capabilities

### New Capabilities

- `project-documentation`: 约定仓库文档分层（根 README、中文入口、`docs/` 子文档）、必备章节与与 CLI 源码的一致性要求。

### Modified Capabilities

- （无）本变更不修改现有产品行为规格；仅新增文档交付相关 SHALL 要求。

## Impact

- **仓库**：新增与修改 Markdown 文件（根目录、`docs/`），可能微调 `packages/web/README.md` 的交叉引用。
- **流程**：贡献者需按 `project-documentation` 规格更新文档；发版或 CLI 变更时需对照 `cli.ts` 核对 CLI 手册。
- **代码**：无应用代码变更要求；可选增加极轻量检查（例如 CI 中 `markdown` 或链接检查）仅在 tasks 中作为后续项评估，非必须。
