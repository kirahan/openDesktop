## 1. Recipe 模型与持久化

- [x] 1.1 定义 Recipe TypeScript 类型与 `schemaVersion: 1` 字段约定（含 `steps[].action`、`click` 的 `selector`、兜底用 `match` 字段）
  - [x] Test: 单元测试校验合法/非法 JSON 样例（覆盖未知 action、缺 selector）
- [x] 1.2 实现配方根路径解析（配置项或环境变量 + 默认策略）与按 `app` 子目录解析 `id.json`
  - [x] Test: 单元测试路径拼接与非法路径拒绝（若适用）

## 2. 执行器（CDP + 兜底）

- [x] 2.1 实现 `runRecipe`（或同等命名）核心流程：逐步 `click`，传入 `cdpPort`/`targetId`，尊重 `allowScriptExecution`
  - [x] Test: mock `clickOnTarget`，断言调用顺序与失败早停
- [x] 2.2 集成 DOM 兜底：`click` 失败或可选 verify 失败时拉取 HTML，调用 `domExplore` 候选，按 `match` 选唯一候选并重试
  - [x] Test: 固定 HTML 片段 + 匹配规则 → 期望选中 selector；多候选时失败且不写盘
- [x] 2.3 实现成功后内存合并与原子写回（临时文件 + rename），更新 `selector`/`updatedAt`
  - [x] Test: 单元测试合并结果与模拟写失败时的错误路径

## 3. HTTP 或 CLI 表面

- [x] 3.1 在现有 createApp/agent 路由中增加 list/read/run（或设计选定的路径），请求体验证 `targetId`、recipe `id`
  - [x] Test: HTTP 测试 mock CDP 与文件系统，覆盖成功、403 SCRIPT_NOT_ALLOWED、兜底写回

## 4. 文档与示例

- [x] 4.1 在 `README` 或 Core 包内短文说明配方目录布局、示例 JSON、与 `allowScriptExecution` 的关系
  - [x] Test: 无（文档任务）；或若有 Doctest/快照则补充
