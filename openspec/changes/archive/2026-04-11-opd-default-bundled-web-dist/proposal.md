## Why

发行包 `@hanzhao111/opendesktop` 已随包附带 **`web-dist`**，但用户执行 **`opd core start`** 时若不手动传 **`--web-dist`**，Core 仍按「无 SPA」启动，终端提示也与「默认带 Web」的产品预期不一致。应在 CLI 层按明确优先级解析默认静态目录，并同步更新文档与启动提示文案。

## What Changes

- 在 **`opd core start`** 解析 **Web 静态目录** 时采用固定优先级：**显式 `--web-dist` 参数** 优于 **`OPENDESKTOP_WEB_DIST` 环境变量** 优于 **相对 CLI 入口自动探测的 `../web-dist`**（存在有效入口文件时）；三者均无时行为与当前「仅 API」一致。
- 调整 **`core start` 成功后的终端输出**（及任何相关 **CLI 帮助 / 错误提示**），区分「已托管 SPA」与「仅 API」，避免再出现与默认带包矛盾的说法。
- 更新 **根 README、`packages/opendesktop/README`、`docs/CLI.md`** 等用户文档：说明发行版 **`opd core start` 即可带 Web**；源码 / 仅 Core 路径下仍需显式 `--web-dist` 或环境变量的情况单独说明。
- **非目标**：不改变 HTTP API 行为；不在此变更中修改 Web 应用业务 UI（仅文档与 CLI 提示）。

## Capabilities

### New Capabilities

- `opd-bundled-web-default`：约定 `opd core start` 下 Web 静态目录的解析优先级、自动探测路径规则、与 `loadConfig` 的配合方式，以及 CLI 启动成功提示的 SHALL 行为。

### Modified Capabilities

- `opendesktop-npm`：补充发行包「默认可通过 `opd core start` 使用随包 `web-dist`」的文档与行为约定（与主规格 delta 对齐）。
- `project-documentation`：CLI 手册中关于 `core start`、`--web-dist`、环境变量的表述与上述优先级一致。

## Impact

- **代码**：`packages/core/src/cli.ts`（`core start`、提示文案）、可选小函数模块（如解析 `import.meta.url` 旁 `web-dist`）；必要时微调 `loadConfig` / `startDaemon` 的调用方式以避免 **重复覆盖** `webDist`。
- **文档**：根 `README` / `README_CN`、`packages/opendesktop/README`、`docs/CLI.md`。
- **测试**：Core CLI 相关单测或集成测；覆盖「有 / 无 `web-dist` 目录」及优先级。
