## MODIFIED Requirements

### Requirement: 发布文件范围

`@hanzhao111/opendesktop` 的 `package.json` **SHALL** 使用 **`files` 字段**（或等效机制）限制发布内容，**SHALL** 仅包含运行 CLI 与**随包 Web 静态资源**所必需的构建产物与元数据（如 **`dist/`**、**`web-dist/`**、`LICENSE`、`README.md`），**SHALL NOT** 包含 monorepo 全部源码、`openspec` 草稿、未构建的 TypeScript 源树（除非明确列为产品的一部分）。

#### Scenario: 包体积可控

- **WHEN** 对该包执行 `npm pack`
- **THEN** 解压后的文件树中 **不包含** 仓库根级 `openspec/changes` 目录（除非显式要求，默认不包含）

### Requirement: 用户文档中的安装路径

仓库 **SHALL** 在根 `README.md` 或 `docs/` 下 **SHALL** 提供简短小节，说明如何通过 **npm** 安装 `@hanzhao111/opendesktop` 并使用 **`opd`**，并指向与 **源码开发**（`yarn`、`workspaces`）并列，避免读者混淆两条路径。**SHALL** 说明全局安装后 **`opd core start`** 在**默认随包包含 `web-dist`** 的前提下可**一条命令**启动带 Web 的 Core（与 **`opd-bundled-web-default`** 规格一致），并 **SHALL** 说明何时仍需 **`--web-dist`** 或 **`OPENDESKTOP_WEB_DIST`**（自定义路径、覆盖顺序等）。**SHALL** 在 `packages/opendesktop/README.md`（或等价位置）说明维护者如何**在不发布 registry** 的情况下本地验证（例如同步 dist 与 web-dist 后 `npm install -g .`、`npm pack` 再安装、`npm link`）。

#### Scenario: 新用户区分安装方式

- **WHEN** 阅读者仅阅读根 `README.md` 或指定 `docs` 页面
- **THEN** 其能区分「npm 安装发行版」与「克隆仓库开发构建」两种入口
- **AND** 其能理解发行版下 **`opd core start`** 与随包 Web 的默认关系（在规格生效前提下）
