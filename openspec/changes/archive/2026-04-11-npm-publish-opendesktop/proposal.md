## Why

贡献者与用户目前需从源码仓库安装依赖并本地运行 Core，缺少可通过 **npm registry** 一键获取的发行物；因 **`opendesktop` 与既有包名过于相近**，registry 要求使用 **scoped 名称 `@hanzhao111/opendesktop`**；以 **MIT 协议** 发布首个单包形态（后续再拆精简 core），降低分发与自动化集成成本。

## What Changes

- 在仓库内落实 **可发布的 `@hanzhao111/opendesktop` 包** 定义：`package.json`（`name`、`version`、`bin`、`files`、`engines`、`publishConfig`）、**根目录或指定包目录** 的 **`LICENSE`（MIT）** 与版权声明占位说明。
- **关闭或绕开** 当前阻止发布的 **`private: true`** 策略（通过发布用配置或独立发布目录，具体见 design），使 `npm publish` / CI 可执行。
- **构建产物**：发布前必须包含 **`@opendesktop/core` 的编译输出**；若首版包含 Web UI 静态资源，需在 design 中固定目录与 `od core start --web-dist` 的默认解析策略（可选，首版可仅 CLI）。
- **文档**：根 `README` 或 `docs` 增加「从 npm 安装与运行」小节，与源码路径区分。
- **不**在本变更中强制拆分第二个精简包（留待后续 change）。

## Capabilities

### New Capabilities

- `opendesktop-npm`: 约定 npm 发行物名称、协议、可执行入口、发布文件集合及与源码开发路径的文档分工。

### Modified Capabilities

- （无）现有产品行为规格不因「多一种安装方式」而改变；若 `project-documentation` 需增加「npm 安装」一句链到 README，可在实现阶段用极小 delta 或 README 直接完成，不强制主规格变更。

## Impact

- **仓库**：`package.json`、可能新增 `LICENSE`、CI 工作流（若已有）、`.npmignore` 或 `files` 白名单。
- **维护者**：发版流程（版本号、changelog、npm token）；需注意 **不将 monorepo 机密** 打入包。
- **用户**：`npm i -g @hanzhao111/opendesktop` 或 `npx @hanzhao111/opendesktop` 获得 `od` CLI（行为与源码构建一致）。
