## 1. CLI：快乐路径与校验

- [x] 1.1 实现 `app bootstrap`（或文档约定的等价扩展 `app create`）顺序调用 `POST /v1/apps`、`POST /v1/profiles`、可选 `POST /v1/sessions`；固定默认 Profile id 策略并在 `--help` 与 README 说明
  - [x] Test：Vitest 覆盖成功路径与 409 分支（mock `fetch` 或现有 HTTP 测试夹具）；覆盖「创建前 GET /v1/apps 发现 id 已存在则不调 POST apps」
- [x] 1.2 实现创建前 `GET /v1/apps` 校验 `id` 唯一性；冲突时非零退出与明确文案
  - [x] Test：同上测试文件中断言冲突路径无 `POST /v1/apps` 调用
- [x] 1.3 （可选）补充 `profile list` 或文档说明使用 `GET /v1/profiles`，与提案范围一致即可
  - [x] Test：若有新 CLI 子命令，则增加对应解析/输出单测

## 2. Web：调用名、校验、简化生成 id

- [x] 2.1 注册表单：应用 id（调用名）必填、帮助文案说明即 `oc <appId>`；提交前 `GET /v1/apps` 校验 id 是否已存在
  - [x] Test：对校验函数或提交逻辑做单元测试（若有抽取）；或手测清单写入 PR 描述并由 reviewer 确认
- [x] 2.2 将自动生成 id 改为短 slug + 短后缀（≤6 字母数字），替换过长十六进制默认实现
  - [x] Test：`suggestedAppIdFromExecutablePath` 类纯函数的单测（长度、字符集、碰撞重试若实现）

## 3. 文档与 Spec 归档准备

- [x] 3.1 更新根 `README`：快乐路径命令、调用名与 App-first 关系、多配置=多次注册
  - [x] Test：文档变更无自动化测试；依赖 tasks 1.1/2.1 验收场景人工核对

## 4. 回归

- [x] 4.1 `yarn workspace @opendesktop/core test` 与 `web build` 通过
  - [x] Test：CI 或本地脚本作为 gates
