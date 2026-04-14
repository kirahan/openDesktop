## Context

- **现状**：矢量录制与观测流已使用 `sessionId` + `targetId`；Studio 侧存在「当前选中观测 tab」与全局快捷键分发逻辑。
- **缺口**：多 **被测** `BrowserWindow` 对应多 **调试 target** 时，缺少 **同会话并行多路** 的规格化模型；事件若仅靠焦点推断会产生错误归属。
- **利益相关方**：使用 Studio 录制跨窗口用例的开发者；消费合并时间线与 LLM 工件的后端。

## Goals / Non-Goals

**Goals:**

- 同一会话下 **多个 target 可同时处于录制活跃态**（并行），且每条录制事件 **可证明** 属于哪一 target（及可选窗口标识）。
- 提供 **逻辑全序时间线** 的构造规则（merge），支撑回放、检索与 **入点/出点/检查点** 在 **合并视图** 与 **分轨视图** 上语义一致。
- 为 **快捷键打点** 在 **N>1 活跃 target** 时定义 **唯一、可实现** 的目标选择策略。

**Non-Goals:**

- 规定被测 Electron 应用 **如何** 创建第二个 `BrowserWindow`（应用侧责任）。
- 规定跨 **不同 session** 的合并（本变更仅 **单 session 内** 多 target）。
- 替代 OS 级全局快捷键的注册机制（仍遵循 `studio-global-shortcuts`）。

## Decisions

### D1：窗口标识与 `targetId` 关系

- **选择**：以 **`targetId` 为录制与 Core API 的**主键**；若 CDP/会话模型下「一窗一 target」已唯一对应，则 **窗口标识为可选元数据**（如 `windowLabel` / `debugWindowId`），**必须**与事件一并存储，**不得**替代 `targetId`。
- **备选**：仅用窗口标题推断 — **拒绝**（不稳定）。

### D2：事件归属 — 禁止纯焦点推断

- **选择**：输入类事件 **必须在产生端**（该 target 的采集路径）打上 `targetId`；合并与 UI **只消费** 已带标识的事件。
- **备选**：主进程根据「前台窗口」补写 — **仅允许**作为 **降级/调试** 且须在 spec 中标为 **非 normative** 或 **明确禁止**（本提案选择 **禁止**）。

### D3：时钟与全序 merge

- **选择**：
  - 每 target 事件携带：`monoTs`（该 target 采集路径的单调时间，单位在实现中固定，如 ms）与 `seq`（每 target 递增整数）。
  - 会话级 **锚点** `sessionT0`（会话开始时的 wall 或主进程单调时钟），用于跨 target 粗对齐（可选暴露给 UI）。
  - **全序键**：`(mergeTs, targetId, seq)`，其中 `mergeTs` 由实现从 `monoTs` 与 `sessionT0` 导出（design 实现章节再定公式）；**tie-break**：`targetId` 字符串序，再 `seq`。
- **备选**：纯 wall-clock — **拒绝**（跨线程/延迟不可靠）。

### D4：入点 / 出点 / 检查点

- **选择**：标记记录为 **`mergedTs`（全序时间）** + **`scope`**：`session` | `target`；当 `scope === target` 时 **必须**含 `targetId`。
- **展示**：合并轴上显示 **全局标记**；分轨轴上同一标记在对应 target 轨 **重复或过滤显示**，但 **tooltip/图例** 须说明 `scope`，避免误解。

### D5：快捷键打点 — 目标选择（与 `studio-global-shortcuts` delta 对齐）

- **选择（默认推荐，可在实现前经产品确认）**：**「当前 Studio 选中的观测 tab 所绑定的 target」**；若该 tab 非矢量录制或未绑定 target → **不打点** 并 **文档化提示**（与按钮前置条件一致）。
- **备选**：**「所有活跃录制 target 同时打点」** — 破坏性大，仅作未来选项；**「上次被测交互的 target」** — 需额外状态机，复杂度高。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 多路并发增加 Core/连接资源占用 | 会话级并发上限、背压与错误码在实现 task 中定义 |
| merge 与采集延迟导致顺序与用户直觉不符 | 文档说明以全序键为准；可选 UI「原始 target 内顺序」视图 |
| 快捷键策略与多 tab 心智冲突 | UI 明示当前作用 target；设置中可选未来策略 |

## Migration Plan

- **阶段 1**：规格与数据模型；单 target 行为保持兼容。
- **阶段 2**：Core 与采集链路透传 `targetId` / `seq`；Studio 只读多轨。
- **阶段 3**：合并时间线与标记 UI；快捷键策略落地。

回滚：按功能开关关闭多 target 并行路径，回退单 target 行为。

## Open Questions

- `windowLabel` 是否必须由 Core 分配还是在 attach target 时由客户端声明？
- 合并时间线是否在首版对 **非输入类** 事件（网络、日志）与 **输入类** 分轨展示？

## Testing Strategy

- **单元**：merge 比较器、`scope` 校验、快捷键策略纯函数（若抽取）。
- **集成**：同会话双 target 模拟事件流 → merge 序一致；标记读写 round-trip。
- **E2E（可选）**：Electron 双窗夹具 + 双 target 录制（视 CI 成本）。
- **测试文件位置**：与实现并列或 `packages/core` / `packages/web` 现有 `*.test.ts` 约定。
