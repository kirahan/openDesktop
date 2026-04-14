# session-replay-multi-target-parallel

## 概述

**一句话**：在同一会话内支持被测应用 **多 BrowserWindow / 多 target 并行录制**，事件 **必须** 带 `targetId`，多轨 **merge** 为全序时间线，**入点/出点/检查点** 带全局时间与可选 target 作用域，并在 Studio **合并视图与分轨视图** 一致呈现；**全局快捷键打点** 在并行场景下采用 **单独规定的默认目标选择策略**。

**背景与动机**：多窗协作与快捷键打点是典型用例；仅靠焦点或当前 tab 推断会导致归属不可证明与回放歧义，需在规格层固化模型后再分阶段实现。

**影响范围**：Core 会话/录制与事件 schema、合并与标记存储、Studio 时间线与快捷键逻辑、测试与文档；预估多包（`packages/core`、`packages/web` 等）分阶段落地。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件（预期） |
|---|------|------|-------------------|
| 1 | 会话并行模型 | 同 `sessionId` 多 `targetId` 活跃录制与上限 | Core session / recording |
| 2 | 事件载荷 | `targetId` + `monoTs` + `seq` + 可选窗口元数据 | 采集与 NDJSON/SSE |
| 3 | Merge | 全序键 `(mergeTs, targetId, seq)` | Core 或独立合并模块 |
| 4 | 标记 | `mergedTs` + `scope` + 条件 `targetId` | HTTP/API 与存储 |
| 5 | Studio UI | 合并轴 + 分轨轴 + 一致图例 | `packages/web` |
| 6 | 快捷键 | design D5 默认策略 + 文案 | `App` / shell 相关 |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|-------------------|
| 归属主键 | `targetId` 为主，窗口标识可选 | 标题/焦点推断不稳定 |
| 全序 | mergeTs + targetId + seq | 纯 wall-clock 不可靠 |
| 快捷键打点默认 | 当前选中观测 tab 对应 target（见 design） | 「多 target 同时打点」副作用大；「上次交互」状态机重 |

### 技术细节

- **禁止**将「仅焦点」写为规范路径上的唯一归属依据。
- **合并**：同输入事件集合多次 merge **结果顺序确定性**。
- **标记**：`scope=target` **必须**含 `targetId`；两视图 **语义不得冲突**。

## 验收标准

测试与产品验收以 `specs/session-replay-multi-target/spec.md` 与 `specs/studio-global-shortcuts/spec.md`（delta）中的 **Requirement / Scenario** 为准，逐条可映射测试用例。摘要如下：

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 并行录制 | A 录制中再启 B | B 进入活跃或返回可机读错误；不静默停 A |
| 2 | 单 target 兼容 | 仅单 target | 与变更前兼容 |
| 3 | 事件载荷 | 输出输入类事件 | 含非空 `targetId` |
| 4 | 焦点 | 规范路径 | 不以焦点为唯一依据 |
| 5 | 窗口元数据 | 启用登记 | 事件可带标识且不丢（若持久化） |
| 6 | 序列 | 同 ms 两事件 | 可借 `seq` 区分 |
| 7 | Merge | 同批事件多次 merge | 全序确定性 |
| 8 | 标记 | target 作用域缺 targetId | 拒绝并可机读错误 |
| 9 | 标记 | session 作用域入点 | 出现在会话合并轴 |
| 10 | Studio | 合并 + 分轨 | 同一标记语义一致、可发现 |
| 11 | 并发上限 | 超上限请求 | 可机读错误、不丢事件 |
| 12 | 快捷键策略 | 查看帮助 | 可知多 target 下打点作用对象 |
| 13 | 快捷键 | 无有效上下文 | 不打点 |
| 14 | 快捷键 | 单 target | 与既有行为一致 |

## 实现清单

见本目录 `tasks.md`（含各任务建议测试子项）。

## 测试要点

- Merge 确定性、边界同毫秒、并发错误码。
- 标记 `scope` 校验与 API 错误。
- 快捷键在多 target 下与按钮前置条件一致。
- 回归单 target 路径与现有 `yarn test`。
