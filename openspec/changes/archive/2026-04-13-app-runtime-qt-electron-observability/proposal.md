## Why

OpenDesktop 已支持注册 **Electron（CDP）** 与 **Qt 等原生应用**，但二者观测需求不同：Electron 以 **CDP / 窗口列表 / Agent 快照** 为主；Qt 无可靠 `page` target，依赖 **macOS Accessibility（AX）整树**。进一步，用户希望在 **鼠标附近** 快速查看局部 AX 结构（而非每次拉整棵树），这需要 **全局指针坐标**（计划用 **@nut-tree/nut-js**）与 **按屏幕坐标命中 AX 元素** 的组合能力。当前应用模型未区分「运行时类型」，Studio 对所有会话展示同一套观测卡片，无法按技术栈裁剪 UI。

## What Changes

- 在 **应用定义** 中增加 **UI 运行时类型**（至少区分 **Electron** 与 **Qt**），用于列表 **Tag**、会话行 **观测区组件分流**。
- **Core**：会话列表（或等价只读 API）**附带** 解析后的 `uiRuntime`（或等价字段），避免 Web 多次拉应用列表拼装。
- **macOS 新 HTTP 能力**：在会话 **running + pid** 前提下，结合 **nut-js** 读取的 **屏幕坐标**（或由查询参数传入 `x,y`），返回 **指针位置命中** 的 AX **局部子树**（设计文档定义「周围」的精确语义：父链深度、子树深度、节点上限）。
- **Swift/原生**：扩展或新增 AX 采集逻辑，支持 **`AXUIElementCopyElementAtPosition`**（或等价）及从命中节点向下的受限枚举；与现有整树 dump 共用错误码与权限模型。
- **`GET /v1/version`**：声明 **`native_accessibility_at_point`**（或项目统一 snake_case）等能力（仅 darwin）。
- **Studio Web**：应用列表显示 **Electron / Qt** 标签；会话观测区按 **`uiRuntime`** 渲染：**Electron** 保持现有观测卡片；**Qt**（且 macOS 能力满足时）仅展示 **「原生无障碍树（整树）」** 与 **「捕获无障碍树（鼠标周围）」** 两个主操作及对应结果视图。

## Capabilities

### New Capabilities

- `app-runtime-kind`：应用与会话层面的 **UI 运行时分类**、存储字段、API 暴露与 Studio **标签 / 观测分流** 契约。
- `native-accessibility-at-point`：**按屏幕坐标**（与会话 PID 绑定）采集 **局部 AX 树** 的 HTTP 行为、参数、上限、错误码及 **nut-js 坐标来源** 约定。

### Modified Capabilities

- `app-register-bootstrap`：**新增** 注册载荷中与 **运行时类型** 相关的字段及默认值（向后兼容），不改变既有 id 校验与快乐路径的既有要求。

## Impact

- **packages/core**：`AppDefinition` 扩展、`POST/GET /v1/apps`、会话列表聚合、`@nut-tree/nut-js` 依赖（及可能的 **预编译/授权** 约束）、macOS AX 子进程扩展、新路由、version `capabilities`。
- **packages/web**：注册表单、应用表、会话观测区 **条件渲染**、Qt 双按钮 UX。
- **权限**：与现有 AX 整树一致，终端/Core 需 **辅助功能**；nut-js 在 macOS 上文档要求同类权限，需在 **docs** 中一并说明。
- **Breaking**：默认 **无**——旧应用缺省视为 **Electron**（或与 `injectElectronDebugPort` 对齐的迁移规则，见 design）。
