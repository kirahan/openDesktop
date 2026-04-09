## Why

在 Electron/WebView 场景下，重复性 UI 操作（例如将顶部 Tab 切到「文档」）若每次都由模型「从零」推理，成本高且不稳定。需要一种**可持久化的操作配方**：优先用已有 CDP 能力（如 `click` + 已知 selector）执行；当页面结构变化导致配方失效时，**兜底重新分析 DOM** 得到新定位并继续；**成功后写回 JSON**，使下次执行更快、更稳。

## What Changes

- 引入**操作配方（operation recipe）**的目录化存储与 JSON Schema（版本化），描述应用标识、步骤、定位器、校验与元数据。
- 提供**配方执行管线**：按步骤调用现有 CDP 封装（与当前 Agent `click` 等路径一致）；步骤失败时触发 **DOM 再探索**（与现有 `domExplore` / `explore` 能力对齐），生成候选 selector 并重试或要求显式确认策略。
- **成功路径上更新 JSON**：将本次生效的 selector、时间戳、可选校验快照摘要写回配方文件（原子写、可配置是否自动合并）。
- 新增对外能力（HTTP 或 CLI 子命令二选一或组合，由 design 定稿）：列出/读取/执行/校验配方；错误码与超时与现有 CDP 会话模型一致。
- **非目标**：不替代完整 E2E 测试框架；不保证跨大版本 UI 零维护（需 `lastVerified` 与人工审阅策略）。

## Capabilities

### New Capabilities

- `cdp-operation-recipes`：配方文件格式、存储布局、执行语义（CDP 优先、DOM 再分析兜底、成功写回）、可测试的验收标准。

### Modified Capabilities

- （无）本变更以新增能力为主；与 `agent-dom-explore` 在实现上可复用 `domExplore` 模块，但不改变其已发布 spec 中的需求表述，除非后续单独发起 amend。

## Impact

- **代码**：`packages/core` 下 CDP 客户端（`clickOnTarget` 等）、`cdp/domExplore.ts`、HTTP Agent 路由或 CLI（`cli-oc-app-first` 风格）注册点；可能新增 `recipes/` 或配置根路径。
- **数据**：用户或仓库内 JSON 配方文件；需注意 gitignore / 敏感信息（仅本机路径与无隐私 DOM 摘要）。
- **依赖**：现有 `cheerio`/`domExplore`、CDP 会话与 `targetId` 生命周期；不新增重型依赖除非 design 论证需要。
