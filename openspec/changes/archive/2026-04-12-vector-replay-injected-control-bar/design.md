## Context

- 当前矢量录制通过 CDP `Runtime.evaluate` 注入监听脚本，使用 `Runtime.addBinding`（`odOpenDesktopReplay`）将事件行送回 Core，再经 SSE 推送到 Web。
- 已有 **检视 overlay**（`#__odReplayInspectRoot`）使用 `pointer-events: none` 避免挡住真实交互；**控制条**需要可点击，因此 **不能**仅靠 `pointer-events: none`，必须在事件发送前 **显式过滤** `event.target` / `composedPath()` 是否落在控制条根节点内。
- 页面内的脚本 **无法安全持有** Core 的 Bearer token；跨域 `fetch` 至 `127.0.0.1:8787` 需 CORS 与 token 传递，**不推荐**作为默认方案。

## Goals / Non-Goals

**Goals:**

- 提供贴边悬浮条 UI：至少支持 **停止录制**；在可行前提下支持 **开始录制**（同一会话、同 target 再次 start）与 **断言检查点**（见下）。
- 控制条上的交互 **不得** 进入矢量 JSON（与 `pointermove` / `click` 等同级过滤）。
- 通过 **第二条 CDP binding**（名称待定，如 `odOpenDesktopReplayUi`）将 `{ cmd: ... }` 从页面送达 Core，由 Core 调用既有 `startPageRecording` / `stopPageRecording` 及（可选）向订阅者推送检查点事件。

**Non-Goals:**

- 首版不实现操作系统级全局热键。
- 首版不实现截图像素级比对或完整「预期 DOM 树」编辑器。
- 不在页面内持久化明文 Bearer token。

## Decisions

### D1：控制指令走 CDP Binding，而非页面 fetch

- **选择**：新增专用 `Runtime.addBinding`，Core 在 `Runtime.bindingCalled` 中解析 JSON 命令并执行。
- **理由**：与现有 `odOpenDesktopReplay` 一致；不引入 CORS；会话与 `targetId` 已由当前 CDP attach 上下文确定。
- **备选**：`fetch` + CORS + 短时 token → 攻击面与配置成本更高。

### D2：控制条根节点稳定标识与过滤

- **选择**：单一根节点（如 `id="__odReplayControlBar"`）及 `data-opendesktop-replay-ui="control-bar"`；在现有 `pointermove` / `pointerdown` / `click` 发送前若 `controlRoot.contains(event.target)` 则 `return`。
- **理由**：与检视层区分清晰；支持按钮可点、不录制。

### D3：「断言检查点」首版语义

- **选择**：首版将「确定断言」实现为 **向 SSE 推送一条结构化事件**（如 `type: assertion_checkpoint`，可含可选 `note` 或时间戳），由后续 LLM 制品或测试录制管线消费；**不**强制实现可视化断言编辑器。
- **理由**：先打通「用户意图锚点」数据流，降低首版范围。
- **备选**：仅 UI 按钮占位不发事件 → 不利于端到端验证。

### D4：首次开始录制是否必须经 Web

- **选择**：允许首版要求用户 **至少一次** 从 Web 或 CLI 发起 `replay/recording/start` 以建立句柄；控制条以 **停止 / 再开 / 检查点** 为主。若技术上零成本复用同 inject 内 binding 调 `startPageRecording`，可列为 follow-up。
- **理由**：避免未建立会话时页面孤立调用 start 的边缘情况；可在 tasks 中列为可选项。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 注入脚本体积增大 | 控制条 DOM 与样式保持极简；必要时拆分构建或压缩 |
| 与宿主页面样式冲突 | 使用 Shadow DOM 或极高特异性前缀类名（待 spike） |
| 恶意页面滥用 binding | 本地信任模型；仅调试 attach 上下文有效 |
| 检查点事件与现有 schema 混排 | 在 `schema.ts` 显式解析；非法行丢弃并记日志 |

## Migration Plan

- 新功能默认随 `replay/recording/start` 注入 **可选**（由 API 查询参数或 body 字段 `injectPageControls: true` 控制），便于灰度。
- 旧客户端不传参则行为与现网一致。

## Open Questions

- 控制条是否使用 **Shadow DOM** 以隔离 CSS（实现成本 vs 兼容性）。
- `assertion_checkpoint` 是否写入 **测试录制落盘制品** 的 `steps` 还是独立边车字段。
- 是否需要 **拖拽移动** 控制条位置；若需要，拖拽过程事件同样必须过滤。

## Testing Strategy

- **单元**：`parseReplayEnvelope`（若扩展类型）、binding 负载解析纯函数。
- **集成 / HTTP**：`POST replay/recording/start` 带 `injectPageControls` 时，模拟 `bindingCalled` 或端到端 CDP mock，断言 `stop` 后录制关闭。
- **注入脚本**：对「点击控制条按钮不产生 click 行」做 **字符串级或 VM 级** 回归（与现有 recording 注入测试风格对齐）。
- **Web**：可选 E2E 仅覆盖开关展示，非阻断。
