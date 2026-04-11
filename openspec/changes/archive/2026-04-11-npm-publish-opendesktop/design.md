## Context

仓库为 yarn workspaces：`@opendesktop/core` 提供 `od` CLI（`bin` 指向 `dist/cli.js`），根 `package.json` 名为 `opendesktop` 且 **`private: true`**，无法直接 `npm publish`。发布用包使用 **`@hanzhao111/opendesktop`**（未 scoped 的 `opendesktop` 与 `open-desktop` 等过于相近，registry 会拒绝），协议采用 **MIT**。

## Goals / Non-Goals

**Goals:**

- 提供 **单一 npm 包 `@hanzhao111/opendesktop`**（首版），安装后全局或 `npx` 可使用 **`od`**，行为与自源码构建的 Core CLI 一致。
- 发布物内含 **MIT `LICENSE`** 及与 SPDX 一致的 **`package.json` license 字段**。
- 通过 **`files`**（或等效 `.npmignore`）限制 tarball 内容，**不**包含源码树、密钥与无关 monorepo 文件。
- 文档中说明 **npm 安装** 与 **克隆开发** 两种路径。

**Non-Goals:**

- 本阶段 **不**发布第二个精简 `@opendesktop/core` 包（后续 change）。
- 本阶段 **不**强制将 Web UI 静态资源打入首包（可作为后续增强；若首版即包含，须在实现中单独列任务与体积评估）。

## Decisions

| 决策 | 选择 | 理由 | 备选 |
|------|------|------|------|
| 发布入口位置 | **独立 workspace 包目录** `packages/opendesktop`，`name` 为 **`@hanzhao111/opendesktop`**，`publishConfig.access` 为 **`public`**，`bin` 指向本包内 **`dist/cli.js`**（由 prepublish 自 `@opendesktop/core` 构建复制而来） | 保持根 `private: true` 不妨碍 monorepo 日常；发布清单清晰 | 根目录直接 `private: false`（易误发整个 repo 元数据） |
| 与 `@opendesktop/core` 关系 | 构建期 **复制** `packages/core/dist` 到发布包 `dist/`（或 `npm pack` 前脚本同步） | 首版单包不依赖 registry 上的 `@opendesktop/core`；用户只装 `@hanzhao111/opendesktop` | 将发行包设为对 `@opendesktop/core` 的薄封装依赖（需先发布 core，与「先发一个包」冲突） |
| 协议 | **MIT**，根 LICENSE 与发布包内一致 | 用户已确认 | Apache-2.0 等 |
| 版本策略 | 与 Core 语义版本 **对齐或跟踪**（如均 `0.1.0` 起），在发布包 `package.json` 中显式 `version` | 减少认知负担 | 独立主版本 |
| CLI 名称 | 维持 **`od`**（与现有 `bin` 一致） | 与文档一致 | 新增别名 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| `npm pack` 体积过大 | 严格 `files` 白名单；排除 `packages/web`、测试与源码 |
| 复制 `dist` 与 core 源码漂移 | `prepublishOnly` 先 `yarn workspace @opendesktop/core build` 再同步 |
| 误发私有信息 | 发布前 checklist；CI 中 `npm publish --dry-run` |
| 许可证头与第三方声明 | MIT 文件含标准免责声明；依赖列表随 `package.json` dependencies 进包（若仅复制 dist 无 npm 依赖则主要为本仓库版权声明） |

## Migration Plan

- **首次发布**：维护者在 registry 创建/登录，在 `packages/opendesktop` 执行 `npm publish --access=public`（或 CI OIDC；scoped 包需 public 或组织策略）。
- **回滚**：在 npm 上 `deprecate` 某版本；用户侧锁版本重装。
- **后续拆 core 包**：新 change 将发布物拆分为 npm 发行包（元/胖）与 `@opendesktop/core`（瘦），本设计不阻塞。

## Open Questions

- 首版是否 **捆绑 Web `dist`**（若捆绑，需固定 `--web-dist` 解析与包内相对路径）。
- 是否使用 **Provenance**（npm trusted publishing）与 **2FA** 策略（组织策略）。

## Testing Strategy

- **自动化**：在 CI 或本地脚本中执行 **`npm pack`**（或 `yarn workspace @hanzhao111/opendesktop pack`），断言 tarball 内含 `package.json`、`LICENSE`、`dist/cli.js` 及 `bin` 可解析；可选 **smoke**：解压到临时目录并 `node dist/cli.js --help`。
- **手工**：全新目录 `npm i -g ./opendesktop-0.1.0.tgz`（或 link）后运行 `od doctor` / `od --help`。
- **测试文件**：可在 `packages/opendesktop` 下增加轻量脚本由 `package.json` `scripts.test:pack` 调用，或由根 CI job 内联。
