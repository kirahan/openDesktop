## Why

被测 **Electron 应用** 常存在多个 `BrowserWindow`：用户需在窗口间来回操作，且依赖快捷键打点。当前会话录制与 Studio 交互多隐含 **单 target / 当前选中 tab** 上下文，无法从规格上保证 **同一会话多路并行**、**事件归属可证明**、**合并时间线与分段标记** 在多窗场景下的一致性与可测试性。需要在 OpenSpec 层固化目标模型，再分阶段实现。

## What Changes

- 引入 **同一会话（session）下多 `targetId` 并行录制** 的能力边界与验收标准（面向被测应用多窗口 / 多调试目标）。
- 规定 **每条输入类录制事件 MUST 携带 `targetId`**；若需区分同应用内窗口，**MUST** 携带稳定 **窗口标识**（与 `targetId` 关系在 design 中定义）；**禁止**仅以 OS/Studio 焦点推断归属。
- 规定 **时间线模型**：各 target **独立单调时钟与序列**，合并为 **全序时间线**，并定义 **会话时钟锚点** 与 **tie-break** 规则。
- 规定 **入点 / 出点 / 检查点**：持久化 **全局合并时间** + **可选 target 作用域**；Studio **合并时间线视图** 与 **分轨（按 target）视图** 对同一标记 **展示语义一致**。
- 规定 **全局快捷键打点** 在 **多 target 并行活跃** 时的 **目标选择策略**（独立 requirement，见 `studio-global-shortcuts` delta）。

## Capabilities

### New Capabilities

- `session-replay-multi-target`：多 target 并行录制、事件标识、合并时间线、分段与检查点存储及 Studio 展示一致性。

### Modified Capabilities

- `studio-global-shortcuts`：在 **多 target 并行** 条件下，为 **打点类动作** 增加 **目标选择策略** 的规范性要求（ADDED requirements；不改变既有「闭集动作 ID」与 Electron 注册语义）。

## Impact

- **Core / 会话与录制管线**：会话状态机、并发录制、NDJSON/SSE 事件模式、合并与存储。
- **Studio / Web**：观测抽屉、时间线 UI、快捷键处理与「当前作用 target」的显式规则。
- **测试**：合并序、标记作用域、快捷键策略的单元与集成测试。
- **与现有 `targetId` 语义对齐**：在单 target 场景下行为保持为既有实现的特例（非 BREAKING，除非实现证明必须调整 API——则在 design 中单独列出）。
