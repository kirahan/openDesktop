## Why

当前 Studio 通过 Agent `console-messages` 在**短时窗口**内采样 CDP `Runtime.consoleAPICalled`，结果一次性展示，体验接近「抓一段日志」而非 DevTools **持续滚动的控制台**。用户需要在统一区域（例如右侧 Dock）**实时**看到所选调试目标的控制台输出，便于联调时与截图、拓扑等并列使用。本变更**仅覆盖 Console 实时流**，不包含 Network 面板或请求监听。

## What Changes

- Core（或 Control API 层）提供**可订阅的 Console 事件流**：在会话 `running`、CDP 可用时，对指定 `targetId` 建立可持续的 CDP 监听，将 `Runtime.consoleAPICalled`（及规范中明确的异常事件若需要）以**流式**方式推送给客户端；定义连接生命周期（开始/停止/切 target/会话结束）。
- Studio（Web）：在固定区域（建议右侧）提供 **Live Console** UI：订阅上述流、追加渲染、基础控制（如清屏、可选条数上限/截断提示）；**不**实现 Network 列表、HAR 或 response body。
- 安全与策略：流式接口须与现有 Bearer 与会话模型一致；明确与 `allowScriptExecution` 的关系（监听一般为只读 CDP，是否在 spec 中写死为**不依赖**脚本开关需与实现对齐）。
- **非目标**：不实现 `Network.*` 订阅、不实现与 DevTools 1:1 的 filter 全能力（可在后续 change 扩展）。

## Capabilities

### New Capabilities

- `studio-live-console`: Studio 侧对单会话单 target 的**实时控制台日志**展示与订阅生命周期；依赖 Control API 提供事件流（SSE 或 WebSocket 等形式在 design 中固定）。

### Modified Capabilities

- （无）仓库根 `openspec/specs/` 当前无既有 capability 文件；本 change 以新建 spec 为主。若后续归档时合并入主规格库，再处理 `opendesktop-studio` / `opendesktop-control-api` 的 delta。

## Impact

- **packages/core**：新增流式端点与 CDP 长连接/订阅管理（或与现有短连接策略并存），需注意资源与并发上限。
- **packages/web**：`App.tsx` 或拆出组件：Live Console 面板、与现有 `console-messages` 按钮关系（并存、替换入口或降级说明在 design 定稿）。
- **文档**：README / PRODUCT 可选补充「实时控制台」与「短时采样」的差异。
- **依赖**：无新版本强依赖假定；传输层选型在 `design.md` 确定。
