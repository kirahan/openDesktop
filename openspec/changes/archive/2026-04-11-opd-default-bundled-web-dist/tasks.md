## 1. CLI 解析与启动链

- [x] 1.1 在 `packages/core` 中实现 **`resolveBundledWebDist()`**（或等价）：基于 **`import.meta.url`** 定位 **`dist/cli.js`**，探测 **`../web-dist/index.html`**，返回绝对路径或 `undefined`
  - [x] Test: 单元测试覆盖「存在 `web-dist/index.html` / 不存在 / 仅缺 index」路径（可用临时目录与 `import.meta.url` mock 或子进程）
- [x] 1.2 在 **`cli.ts`** 的 **`core start`** 中合并 **`effectiveWebDist = opts.webDist ?? process.env.OPENDESKTOP_WEB_DIST ?? resolveBundledWebDist()`**，并 **单次** 传入 **`startDaemon`**；核对 **`loadConfig`** 与 **`startDaemon`** 调用链，**避免** `webDist` 被 flag、env **重复合并**
  - [x] Test: 对 `startDaemon` / `loadConfig` 的 mock 或集成测试验证优先级（至少：仅 flag、仅 env、仅 bundled、flag 覆盖 env）
- [x] 1.3 更新 **`core start` 成功后的终端输出**（及 **`coreUnreachable`** 等若仍写死「须 od core start --web-dist」类文案）：按 **`config.webDist`** 是否为空区分「已托管 SPA」与「仅 API」
  - [x] Test: 快照或字符串断言关键句在「有/无 webDist」下符合 `opd-bundled-web-default` spec

## 2. 文档

- [x] 2.1 更新 **根 `README.md` / `README_CN.md`**：npm 小节与「启动 Core」示例与 **`opd core start` 默认可带随包 Web** 一致，并指向 **`docs/CLI.md`** 说明优先级
  - [x] Test: `docs:check-links` 或现有 readme 链接测试通过
- [x] 2.2 更新 **`docs/CLI.md`**：`core start`、`--web-dist`、环境变量、随包探测优先级
  - [x] Test: 人工 checklist 对照 `opd-bundled-web-default` 与 `project-documentation` delta
- [x] 2.3 更新 **`packages/opendesktop/README.md`**：与发行版默认一条命令、自定义 **`--web-dist`** 场景一致；必要时调整 **`start:web`** 脚本说明
  - [x] Test: 无自动化则文档审阅勾选

## 3. 回归与归档准备

- [x] 3.1 运行 **`yarn test`**（含 **`@opendesktop/core`** 与 **`@hanzhao111/opendesktop`**）
  - [x] Test: 全绿
- [x] 3.2 （可选）**`openspec validate`** 或变更内 **spec 自检**：Scenario 标题均为 **`####`**
  - [x] Test: CLI 退出码 0
