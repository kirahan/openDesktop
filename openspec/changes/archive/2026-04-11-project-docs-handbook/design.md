## Context

根目录 `README.md` 已包含安装、Core 启动、`yarn oc` 与 App-first 等大量内容；`docs/PRODUCT.md` 承载 OpenSpec 能力总览。CLI 的真实命令树与帮助文案以 `packages/core/src/cli.ts` 为准，尚无单独的「CLI 手册」页。用户需要中英文入口与 `docs/` 分层，避免重复维护三份全文。

## Goals / Non-Goals

**Goals:**

- 定义清晰的信息架构：根 README 负责「快速上手」，`docs/` 负责「查阅手册」。
- 提供 `README_CN.md` 作为中文入口，结构与英文 README 对齐。
- 新增 `docs/CLI.md`（名称可按最终实现微调），内容与 `od --help` 及 App-first 说明一致，并注明信息来源（源码路径）。
- 根 README 与中文 README 顶部互相链接。
- 修正 `docs/PRODUCT.md` 中影响阅读的表格断行问题。

**Non-Goals:**

- 不实现独立文档站点或 MkDocs 等框架（除非后续单独变更）。
- 不自动生成 CLI 参考（本阶段以手工维护为准；可在 Open Questions 中记录未来自动化）。
- 不修改 HTTP API 或 CLI 行为。

## Decisions

| 决策 | 选择 | 理由 | 备选 |
|------|------|------|------|
| 中文 README 文件名 | `README_CN.md` | 常见约定，与 `README.md` 并列易发现 | `README.zh-CN.md` |
| 包管理器在文档中的表述 | 以 **yarn** 为主（与贡献者规则一致），必要时注明 npm 等价命令 | 与仓库实践一致 | 仅写 npm |
| CLI 手册深度 | 命令全表 + 全局选项 + App-first + 退出码摘要；子命令参数细节以 `--help` 为准 | 平衡维护成本与可用性 | 仅链接到 `--help` |
| API 文档 | 首版可为「速查表 + 链到 openspec」；完整 OpenAPI 不在本变更范围 | 控制篇幅 | 单独 change |
| `packages/web/README.md` | 保留为 Web 包说明，根 README `docs/STUDIO.md` 或「Studio」小节链入 | 避免重复大段 | 合并进 docs 单页 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 文档与 `cli.ts` 漂移 | 在 `docs/CLI.md` 文首写明「以源码为准」与最后审阅日期；tasks 中含「发版前核对」检查项 |
| 中英文重复 | 中文 README 短写 + 链到 `docs/` 与英文 README，避免双份长表 |
| PRODUCT 与操作手册混淆 | PRODUCT 保持 SHALL 能力视角；文首增加「操作说明见 README 与 docs/CLI」一句 |

## Migration Plan

- 文档变更无运行时迁移。合并后建议 CONTRIBUTORS 或 README 中一行说明「文档结构见 `openspec/specs/project-documentation`」。
- 回滚：恢复删除的 README 段落可通过 Git 回退；无数据迁移。

## Open Questions

- 是否在 CI 增加 `markdownlint` 或链接检查（可选，工作量另估）。
- `docs/API.md` 是否在首版必交付，或作为第二阶段与 `tasks.md` 可选任务。

## Testing Strategy

- **手工验收**：对照 `project-documentation` 规格中的场景逐项勾选；本地运行 `yarn workspace @opendesktop/core cli -- --help` 与文档中的命令树示例一致。
- **自动化**：无强制单测（文档为主）。若引入链接检查脚本，可对 `docs/**/*.md` 与根 README 做 PR 级校验；放置位置建议为根 `package.json` 脚本，由 CI 调用（实现时单独评估）。
