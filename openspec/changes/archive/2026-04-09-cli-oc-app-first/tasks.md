## 1. 规格对齐与单测

- [x] 1.1 对照 `specs/cli-oc-app-first/spec.md`，审阅 `parseAppFirstArgv.ts` / `appFirstRun.ts`：确认保留字、`APP_FIRST_COMMANDS`、`topology` 别名与 spec 一致；若有偏差则最小修正实现或更新 delta（以 spec 为准）
  - [x] Test: 扩展或补强 `parseAppFirstArgv.test.ts`（及必要的 `appFirstRun` 测例）：覆盖保留顶层名、`list-window`/`metrics`/`list-global`/`snapshot`、`topology` 别名、非法多余参数
- [x] 1.2 可选：当第二参数形似用户误写的子命令但不在白名单时，评估是否给出更明确错误（不破坏现有 Commander 回退行为）；若做，补测试

## 2. 文档与帮助

- [x] 2.1 更新根目录 `README.md`：App-first 小节与 `cli-oc-app-first` spec 用词一致（`yarn oc <appId> <子命令>`、子命令列表、`topology` 说明、`od` bin 关系）
  - [x] Test: 可选 README 片段断言（若项目无此类测试则跳过）

## 3. 可发现性（可选）

- [x] 3.1 评估在 `od --help`（或 cli 入口帮助）中增加 App-first 速查三行；若采纳则实现并手动验收
  - [x] Test: 若有快照/CLI 输出测例则补充，否则记入手动验收说明（已用 `node --import tsx src/cli.ts --help` 手验文末段落）

## 4. 回归

- [x] 4.1 `cd packages/core && yarn test` 全部通过
  - [x] Test: 作为收尾门槛
