## Context

- `AppDefinition`（`packages/core/src/store/types.ts`）已有 `injectElectronDebugPort` 等字段，**尚无**显式「Electron vs Qt」分类；Web 与 CLI 注册路径需对齐。
- 会话 `SessionRecord` 含 `profileId`，Profile 绑定 `appId`，故可由 Core **派生** `uiRuntime` 而无需客户端二次查询（可选仍保留 `GET /v1/apps` 展示 Tag 详情）。
- **整树 AX** 已由 `mac-native-a11y-tree` 实现（Swift dump + `GET .../native-accessibility-tree`）。本变更增加 **按点命中** 的局部树。
- **nut-js**（`@nut-tree/nut-js`）可在 Node 中 `await mouse.getPosition()` 获取屏幕像素坐标；**不能**替代 AX API，仅解决「鼠标在哪」。

## Goals / Non-Goals

**Goals:**

- 可持久化、可展示的 **运行时类型**（`electron` | `qt`），并驱动 **Studio 观测 UI 分流**。
- **macOS**：在 **同一会话 PID** 下，基于 **屏幕坐标** 返回 **局部 AX 子树**（可机读 JSON，与整树节点形态兼容）。
- **坐标获取**：以 **@nut-tree/nut-js** 为默认实现；若安装/授权失败，接口 SHALL 返回明确错误码，并允许 **查询参数覆盖坐标**（便于调试与无 nut 环境降级策略留口）。
- **Qt 会话观测**：仅保留 **整树** + **鼠标周围** 两个主入口（其余 CDP 类卡片不展示或禁用）。

**Non-Goals:**

- Windows/Linux 全局鼠标或 AT-SPI（后续变更）。
- 自动点击、模拟输入（nut-js 虽具备能力，本变更 **不** 暴露「控制键鼠」的 HTTP）。
- 完美解决 **多显示器坐标系** 的所有边角（首版文档化 + 可测主屏/常见布局）。

## Decisions

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 字段名 | `uiRuntime: "electron" \| "qt"` | `runtimeKind` / `appKind` | 与「UI 技术栈」语义一致，避免与 OS 进程 runtime 混淆 |
| 默认值与迁移 | 缺省 **`electron`** | 从 `injectElectronDebugPort` 推断 | 向后兼容：旧数据无字段时行为与现网一致；新注册显式选 Qt |
| 列表展示 | Core 在 **`GET /v1/sessions`** 每条 session 上增加 **`uiRuntime`**（或嵌套 `app: { uiRuntime }`） | 仅 Web 查 apps | 单次请求即可渲染会话行，避免闪烁与竞态 |
| 坐标来源优先级 | **1**）请求体/Query 传入 `x`,`y` **若存在**；**2**）否则 Core 调 **nut-js `mouse.getPosition()`** | 仅 nut | 测试与无图形环境可手动指定；文档说明生产以 nut 为准 |
| 局部树语义 | 命中 **`AXUIElementCopyElementAtPosition`** 得到 **hit**；响应包含 **`hit` 节点** + **`ancestors`** 向上 **≤8** 层 + **`children` 向下 **≤`maxLocalDepth`（默认 4）****，并受 **`maxNodes`** 全局上限 | 只返回单节点 | 用户要「周围」；深度可查询参数调节 |
| Swift 侧 | **扩展** `native-macos/` 新入口或参数模式：`atPoint` + pid + x,y + 深度上限 | 全在 Node 调私有 API | 与现有 dump 同一进程模型，权限一致 |
| nut-js 分发 | **npm 依赖** `@nut-tree/nut-js`；CI/开发者按官方文档处理 **预编译/订阅** | robotjs | 用户明确要求 nut-js；若授权受阻，tasks 中保留 **备选方案**（文档说明） |
| Electron 会话 UI | **保留**现有观测卡片（list-window / metrics / snapshot / 整树 AX 等） | 合并为一套 | 不回归已有 Electron 工作流 |
| Qt 会话 UI | **仅** 两个主按钮：**整树**、**鼠标周围** | 隐藏 CDP 卡 | 与需求一致；无 CDP 时不展示无意义操作 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| nut-js **授权/费用/预编译** 变更 | design 与 tasks 记录「验证安装」；备选：仅 **手动坐标** API + 外部工具喂坐标 |
| **多显示器** 坐标与 AX 命中不一致 | 首版在 spec 中要求 **文档化坐标系**（主屏左上角原点等）；错误码 `COORD_SYSTEM_MISMATCH` 预留 |
| **权限**：nut-js 与 AX 均需辅助功能 | 与整树共用文档；403 时 UI 统一提示 |
| **安全**：任意会话读全局鼠标 | 仅 **Bearer + 本机会话**；不记录历史轨迹；节流由实现侧建议（如 ≥100ms） |

## Migration Plan

1. **存储**：`AppDefinition` 增加可选字段 `uiRuntime`；读写兼容缺省 `electron`。
2. **API**：`POST /v1/apps` 接受可选 `uiRuntime`；`GET /v1/apps` 返回该字段。
3. **会话**：聚合查询填充 `uiRuntime`；旧会话无字段时默认 electron。
4. **回滚**：移除新路由与依赖；旧客户端忽略未知字段。

## Open Questions

- **nut-js** 在团队 CI（Linux）上 **仅跑单元测试 mock**，不执行真实 `getPosition`——需在 tasks 中写明测试策略。
- Qt 是否 **强制** `injectElectronDebugPort: false`：建议 **不强制**，仅 UI 分流，避免阻塞混合场景。
