## Context

- Core 已具备 CDP 封装（如 `clickOnTarget`）与 Agent 路由（`click` 需 `targetId` + `selector`，且受 `allowScriptExecution` 约束）。
- `domExplore`（`packages/core/src/cdp/domExplore.ts`）可从 HTML 产出带 `selector` 的候选，供后续 `click` 使用。
- 用户诉求：将「可重复的 UI 操作」沉淀为 JSON 配方；**主路径**用 CDP；**失败**时重新分析 DOM；**成功**后写回 JSON，形成闭环。

## Goals / Non-Goals

**Goals:**

- 定义版本化的 **Recipe JSON**（单文件单配方），可被工具与测试消费。
- 实现 **Recipe 执行器**：在有效会话上下文中逐步执行；步骤与现有 CDP 动作对齐（首期至少 `click`）。
- **兜底**：当 `querySelector`/`click` 失败或校验失败时，拉取当前页 DOM（或与现有 `explore` 能力等价的数据源），调用 `domExplore`（或同语义模块）生成候选，按配方中的匹配提示（如 label 子串、tab 角色）选取新 selector 并重试（次数可配）。
- **成功写回**：全部步骤成功且可选 verify 通过后，将更新后的 selector / `lastVerifiedAt` / 可选 `appVersionHint` 以**原子写**方式写回同一 JSON 文件。
- 提供至少一种**可发现入口**（优先：**HTTP API** 挂在现有 createApp/agent 体系，便于与 session 绑定；若与路由分层冲突则 **CLI 子命令**作为同等能力补充，二者共享执行器）。

**Non-Goals:**

- 不承诺跨大版本 UI 的「永久免维护」；配方需 `lastVerifiedAt` 与人工审阅流程。
- 不引入视觉/OCR 兜底（可记为后续扩展）。
- 不修改鉴权/加密模型；配方路径默认视为用户本机数据。

## Decisions

1. **Recipe 存储布局**  
   - **决策**：默认根目录可配置（例如环境变量或 Core 配置项），其下按 `app-slug/` 分子目录，单文件 `recipe-id.json`。  
   - **备选**：单目录扁平 + manifest；否决原因：按 app 分桶更易浏览与权限控制。

2. **执行与 CDP 会话**  
   - **决策**：执行器接收「已解析会话」上下文（含 `cdpPort`、当前 `targetId` 策略）。每步默认沿用同一 `targetId`，除非步骤显式覆盖（例如导航后 target 变化）。首期文档可规定「单页内操作」以限制复杂度。  
   - **备选**：在配方内保存 WebSocket URL；否决：与现有 session 生命周期重复且易过期。

3. **兜底：DOM 再分析**  
   - **决策**：失败时获取页面 HTML（与现有 observability/explore 数据获取路径一致，避免重复发明），调用 `extractButtonCandidatesFromHtml`（或封装函数）得到候选列表；用配方中 `match` 提示（如 `labelContains`、`minScore`）选取唯一或最高分候选；若仍不唯一则失败并返回需人工合并的结构化原因。  
   - **备选**：每次兜底都让大模型选 selector；否决：延迟高、难测试；保留为上层可选策略而非核心必须。

4. **成功后的 JSON 更新**  
   - **决策**：内存中合并步骤级字段 → 写临时文件 → `rename` 同目录替换；可选保留 `.bak` 由配置开关控制。更新字段至少包括：每步最终 `selector`、`updatedAt`；可选记录 `verifiedBuild` 若调用方传入。  
   - **备选**：JSON Patch RFC6902；否决：对终端用户过重，首期用显式合并结构即可。

5. **对外接口形态**  
   - **决策**：实现 **执行器纯函数/模块** + **薄 HTTP 层**（例如 `POST .../recipes/:id/run`），请求体携带 `targetId`（或与会话默认 target 绑定规则在设计评审时写死）。列表/读取为 `GET`。  
   - **备选**：仅 CLI；否决：不利于自动化测试与 Agent 集成；CLI 可作为二期薄封装调用同一模块。

6. **配方校验**  
   - **决策**：运行时校验 `schemaVersion` 与支持的动作集合；拒绝未知 `action` 与缺失必填字段，错误码与现有 `VALIDATION_ERROR` 风格一致。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| DOM 探索选错元素 | `minScore`、label 约束、唯一性检查；失败时拒绝自动写回 |
| 并发同时写同一 JSON | 同进程串行锁；或文档说明「单写者」；原子写降低损坏概率 |
| `allowScriptExecution=false` 导致 click 403 | 执行前显式检查并返回清晰错误，配方文档注明依赖 |
| 页面异步渲染，click 过早 | 步骤级 `waitForSelector`/`waitMs`（首期可二选一作为后续 task） |

## Migration Plan

- 新能力：无存量配方迁移。首次发布默认空目录即可。  
- 回滚：关闭路由注册或 feature flag（若引入）即可；磁盘上 JSON 为用户数据，不自动删除。

## Testing Strategy

- **单元测试**：Recipe JSON 解析/校验；合并写回逻辑；兜底选择算法（给定固定 HTML 片段与 match 规则 → 期望 selector）。  
- **HTTP 测试**：沿用现有 `agentActions.http.test.ts` 风格，mock CDP/`clickOnTarget` 与 HTML 获取，覆盖成功执行、click 失败→兜底成功→写回、以及写回失败时不谎称成功。  
- **位置**：源码旁 `*.test.ts` 或现有 `packages/core/src/http/` 测试文件扩展。

## Open Questions

- 默认配方根路径是否落在仓库内（便于示例）还是仅用户目录（避免误提交）——实现前在 `tasks` 中取一默认值并在 README 一句说明。  
- 是否在首期加入 `wait`/`scroll` 步骤类型，或严格仅 `click`——建议首期仅 `click`，其它动作后续 ADDED。
