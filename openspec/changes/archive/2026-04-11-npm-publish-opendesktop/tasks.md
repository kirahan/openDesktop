## 1. 协议与元数据

- [x] 1.1 在仓库根或发布包目录添加 **MIT `LICENSE`**（含版权年份与持有人占位说明）
  - [x] Test: 本地校验 `LICENSE` 含 MIT 关键词与免责声明段落
- [x] 1.2 按 design 创建或调整 **`@hanzhao111/opendesktop` 可发布包** 的 `package.json`（`name`、`version`、`license`、`files`、`bin`、`engines`、`publishConfig`）
  - [x] Test: `npm pack --dry-run` 或生成 tgz 后检查 `package.json` 字段与 proposal 一致

## 2. 构建与打包

- [x] 2.1 实现 **prepublishOnly**（或 CI 步骤）：先构建 `@opendesktop/core`，再将 **`dist`** 同步到 `opendesktop` 发布目录（路径按 design 固定）
  - [x] Test: 干净 clone 后执行发布前脚本，`dist/cli.js` 存在且 `node dist/cli.js --help` 成功
- [x] 2.2 配置 **`files`** 白名单，排除 monorepo 无关路径；必要时添加 `.npmignore` 补充
  - [x] Test: `npm pack` 解压后无 `openspec/changes` 等（与 spec 场景一致）

## 3. 文档

- [x] 3.1 更新根 **README**（或 `docs` 小节）：`npm i -g @hanzhao111/opendesktop`、`od core start` / `od --help` 示例，与源码开发路径区分
  - [x] Test: 文档审阅 checklist 对照 `opendesktop-npm` spec 中「用户文档」场景

## 4. 可选 CI

- [x] 4.1 （可选）在 CI 中增加 **`npm pack` + 结构断言** 或 dry-run publish
  - [x] Test: CI 工作流在 PR 上成功执行 pack 任务
