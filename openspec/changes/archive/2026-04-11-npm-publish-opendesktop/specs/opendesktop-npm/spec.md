## ADDED Requirements

### Requirement: npm 包标识与协议

以 **npm registry** 分发的 **OpenDesktop CLI 发行包** SHALL 使用 **`name` 字段为 `@hanzhao111/opendesktop`**（scoped 名称；因未 scoped 的 `opendesktop` 与既有包名过于相近被 registry 拒绝）。该包 **SHALL** 在 `package.json` 中声明 **`license` 为 `MIT`**，且在发布 tarball 根目录 **SHALL** 包含 **`LICENSE`** 文件，其内容为 **MIT License** 标准文本（含版权声明占位或实际版权年份与持有人）。

#### Scenario: 检查发布清单

- **WHEN** 维护者执行 `npm pack` 于可发布的 `packages/opendesktop` 目录
- **THEN** 生成的 `.tgz` 解压后存在 `package.json` 且 `name` 为 `@hanzhao111/opendesktop`、`license` 为 `MIT`
- **AND** 解压后存在 `LICENSE` 文件且可读

### Requirement: 可执行入口 opd

`@hanzhao111/opendesktop` 与 **`@opendesktop/core`** **SHALL** 在 `package.json` 的 **`bin`** 中提供全局命令 **`opd`**（指向 `dist/cli.js`），与 Commander 中 **`program.name("opd")`** 一致，避免与 Git for Windows 自带的 **`od.exe`** 冲突。**SHALL** 指向包内可执行的 CLI 入口文件（含 shebang）。

#### Scenario: 全局安装后可用

- **WHEN** 用户在干净环境中执行 `npm install -g @hanzhao111/opendesktop@给定版本`（或等效本地从目录或 tgz 安装）
- **THEN** 终端中可运行 `opd --help` 并得到非空帮助输出
- **AND** 退出码为 0

### Requirement: 发布文件范围

`@hanzhao111/opendesktop` 的 `package.json` **SHALL** 使用 **`files` 字段**（或等效机制）限制发布内容，**SHALL** 仅包含运行 CLI 所必需的构建产物与元数据（如 `dist/`、`LICENSE`、`README.md`），**SHALL NOT** 包含 monorepo 全部源码、`openspec` 草稿、未构建的 TypeScript 源树（除非明确列为产品的一部分）。

#### Scenario: 包体积可控

- **WHEN** 对该包执行 `npm pack`
- **THEN** 解压后的文件树中 **不包含** 仓库根级 `openspec/changes` 目录（除非显式要求，默认不包含）

### Requirement: 用户文档中的安装路径

仓库 **SHALL** 在根 `README.md` 或 `docs/` 下 **SHALL** 提供简短小节，说明如何通过 **npm** 安装 `@hanzhao111/opendesktop` 并使用 **`opd`**，并指向与 **源码开发**（`yarn`、`workspaces`）并列，避免读者混淆两条路径。**SHALL** 在 `packages/opendesktop/README.md`（或等价位置）说明维护者如何**在不发布 registry** 的情况下本地验证（例如同步 dist 后 `npm install -g .`、`npm pack` 再安装、`npm link`）。

#### Scenario: 新用户区分安装方式

- **WHEN** 阅读者仅阅读根 `README.md` 或指定 `docs` 页面
- **THEN** 其能区分「npm 安装发行版」与「克隆仓库开发构建」两种入口
