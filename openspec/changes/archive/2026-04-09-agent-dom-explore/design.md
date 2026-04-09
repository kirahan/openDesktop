## Context

- 已有 Agent 动词：`get`（拉取目标文档 HTML 片段）、`click`、`scroll` 等；`registerObservability` 集中分发。
- 目标：新增**只读**动词，对 DOM 做**解析 + 启发式筛选**，输出「较可能有意义的按钮类候选」，供 Agent 后续用 `click` 等组合；**不在本能力内**做用户可见交互。

## Goals / Non-Goals

**Goals:**

- 单一 canonical 动词（建议名 **`explore`**）：输入 `targetId`，可选 `maxCandidates`、`minScore` 等（具体字段在实现中固定并写入 README）。
- 服务端在 Node 内完成 HTML 解析与筛选；**复用或与 `get` 对齐的 DOM 获取路径**（同一 CDP 调用链），避免「探索」与「get」看到两套不一致快照的歧义（若无法完全同一时刻，须在响应中标注 `truncated`/`snapshotNote` 类字段——见 Open Questions）。
- 返回 JSON：**候选列表**每项至少包含 **展示用标签**、**供后续 `click` 使用的定位线索**（与现有 `click` 载荷对齐的一种：例如 CSS selector 或项目已支持的 selector 字段名）、可选 **score**（0–1 或整数）与 **reason 码** 便于调试与测试。
- 单元测试：对**纯解析/筛选函数**使用 fixture HTML（无真实 CDP），覆盖包含/排除规则与上限截断。

**Non-Goals:**

- 不实现 hover、不自动滚动进视口、不点击。
- 不保证与浏览器无障碍树 100% 一致；不承诺覆盖自定义组件库全部变体。
- 不在此变更引入 LLM。

## Decisions

1. **Canonical 动词名：`explore`**  
   - **理由**：短、与产品用语「探索」一致，且不易与 `get` 混淆。  
   - **备选**：`discover-buttons`（更长、更直白）；若与 future「探索模式」冲突可再改名。

2. **DOM 来源：与 `get` 同源**  
   - **做法**：内部调用与 `get` 相同的「取 `document` outerHTML（或项目现行截断策略）」函数，再在内存中解析；**不**为 explore 单独增加 CDP 语义。  
   - **理由**：行为可预期、实现集中、易测试「同页同快照」假设。

3. **解析栈：HTML 解析库（如 cheerio 或等价）**  
   - **理由**：比正则稳健，便于实现 `button`/`[role=button]`/input 类型等选择器与文本抽取。  
   - **备选**：`linkedom` + 轻量遍历——若 bundle 体积敏感可评估。  
   - **约束**：仅解析字符串，**不**在页面上下文执行用户脚本。

4. **筛选策略（v1）**  
   - **包含**：`<button>`、`input[type=submit|button|reset]`、`[role="button"]`；可选将「类按钮」`<a>` 纳入（需 `href` + 启发式 class/文本长度门槛，默认保守或默认关闭）。  
   - **排除/降权**：`disabled`、`aria-hidden="true"`、无可见文本且无 `aria-label`/`title` 的纯图标（降权或丢弃）；重复文案可去重（保留文档顺序靠前的）。  
   - **上限**：默认最多返回 `maxCandidates`（如 32），按 score 降序截断。

5. **定位线索**  
   - **优先**：生成**唯一性尽可能高**的 CSS selector（项目若已有 `click` 使用的 selector 字段，与其一致）；若无法稳定生成，回退到「标签 + 文本 + 第 N 个匹配」并降低 score。  
   - **理由**：与后续 `click` 一条链打通。

6. **错误与鉴权**  
   - 与现有 Agent action 一致：`targetId` 缺失、会话非 running、CDP/DOM 拉取失败时返回既有错误码风格（可机读 message）。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 启发式误报/漏报 | 输出 `score`/`reasons`；文档说明「候选非保证」；后续迭代可调权重 |
| 大 HTML 内存与耗时 | 与 `get` 共享截断；可选对 explore 单独 `maxHtmlBytes`（Open Question） |
| selector 脆弱（动态 class） | 降权；长期可考虑 backendNodeId（非本变更必做） |

## Migration Plan

- 新动词 additive：旧客户端忽略未知 `action` 即可。  
- 无数据迁移。

## Open Questions

- `explore` 与 `get` 是否**强制同一截断参数**：若 `get` 已截断，explore 是否应在响应中显式 `htmlTruncated: true`？  
- `explore` 请求体是否允许客户端**内联传入 HTML**（用于离线测试）：默认 **否**，仅服务端拉取，简化安全面。

## Testing Strategy

- **单元**：`packages/core` 内纯函数（fixture HTML → candidates），覆盖：基础 button、role=button、disabled 排除、上限截断、空页。  
- **集成**（可选）：mock CDP/HTML 返回，断言 `POST .../actions` 含 `action: explore` 时响应结构。  
- **位置**：与实现文件同目录或 `*.test.ts` 并列（Vitest）。
