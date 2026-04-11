## ADDED Requirements

### Requirement: 根目录英文 README 承担快速上手

仓库根目录 **SHALL** 提供英文 `README.md`，其 **SHALL** 包含：项目一句定位、环境要求、安装与构建、启动 Core 的最短命令、token 获取与 Web 打开方式、指向更细文档的链接。**SHALL NOT** 将完整 CLI 子命令参数表作为唯一信息源而不提供指向 `docs/CLI.md`（或等价路径）的链接。

#### Scenario: 新贡献者首次阅读

- **WHEN** 阅读者仅打开根目录 `README.md`
- **THEN** 其能在五分钟内在文档内找到「如何启动 Core」与「如何设置 API URL 与 token」的步骤
- **AND** 其能看到指向 CLI 详细说明文档的链接或明确章节标题

### Requirement: 中文入口 README

仓库根目录 **SHALL** 提供简体中文入口文档 `README_CN.md`（文件名与此完全一致），内容 **SHALL** 与英文 `README.md` 结构对齐（同级章节顺序一致或显式说明差异），**SHALL** 在文首或显著位置提供指向 `README.md` 的链接；英文 `README.md` **SHALL** 在显著位置提供指向 `README_CN.md` 的链接。

#### Scenario: 中文读者选择语言

- **WHEN** 中文读者打开 `README_CN.md`
- **THEN** 其能完成与英文 README 等价的「安装、构建、启动 Core、使用 token」路径说明
- **AND** 其能找到返回英文 README 的链接

### Requirement: CLI 手册独立成文

仓库 **SHALL** 在 `docs/` 下提供 CLI 手册 Markdown 文件（默认名 `docs/CLI.md`，若重命名须在根 README 与 `README_CN.md` 中同步更新链接）。该手册 **SHALL** 说明：全局选项（如 API URL、token 文件）、顶层子命令分组、App-first 调用形式、与 `packages/core/src/cli.ts` 中实现一致的命令名称。**SHALL** 在文首声明 CLI 行为以源码与 `od --help` 输出为最终依据。

#### Scenario: 查阅与源码一致

- **WHEN** 维护者对照 `packages/core/src/cli.ts` 审阅 `docs/CLI.md`
- **THEN** 文档中出现的命令名称与子命令层级与源码注册一致，无已删除子命令的残留

### Requirement: 产品总览与操作手册分工

`docs/PRODUCT.md` **SHALL** 在文档前部（首段或紧接定位段之后）用一段话说明：本文档侧重能力与规格边界；面向操作的步骤见根 README 与 `docs/CLI.md`。**SHALL** 修复文档内影响阅读的表格断行或损坏行，使表格在常见 Markdown 渲染器下完整可读。

#### Scenario: 区分规格与操作

- **WHEN** 阅读者打开 `docs/PRODUCT.md`
- **THEN** 其能明确该文档不是唯一操作指南，并被指向 README 与 CLI 手册

### Requirement: 文档目录可发现性

根目录 `README.md` **SHALL** 包含指向 `docs/` 下至少 CLI 手册与 `PRODUCT.md` 的链接（相对路径）。若新增 `docs/API.md` 或其他子文档，**SHALL** 在根 README 或 `docs/` 索引段增加链接（可在实现 tasks 中分阶段完成）。

#### Scenario: 从 README 进入 docs

- **WHEN** 阅读者在根 `README.md` 中寻找详细说明
- **THEN** 其能通过点击链接进入 `docs/CLI.md` 与 `docs/PRODUCT.md`
