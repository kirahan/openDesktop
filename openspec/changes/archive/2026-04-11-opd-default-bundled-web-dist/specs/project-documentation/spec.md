## MODIFIED Requirements

### Requirement: CLI 手册独立成文

仓库 **SHALL** 在 `docs/` 下提供 CLI 手册 Markdown 文件（默认名 `docs/CLI.md`，若重命名须在根 README 与 `README_CN.md` 中同步更新链接）。该手册 **SHALL** 说明：全局选项（如 API URL、token 文件）、顶层子命令分组、App-first 调用形式、与 `packages/core/src/cli.ts` 中实现一致的命令名称；**SHALL** 说明 **`core start`** 与 **`--web-dist`**、**`OPENDESKTOP_WEB_DIST`**、**随包 `web-dist` 自动探测** 的优先级关系（与 **`opd-bundled-web-default`** 规格一致）。**SHALL** 在文首声明 CLI 行为以源码与 `opd --help` 输出为最终依据。

#### Scenario: 查阅与源码一致

- **WHEN** 维护者对照 `packages/core/src/cli.ts` 审阅 `docs/CLI.md`
- **THEN** 文档中出现的命令名称与子命令层级与源码注册一致，无已删除子命令的残留
- **AND** **`core start`** 与 Web 静态目录相关描述与 **`opd-bundled-web-default`** 无矛盾
