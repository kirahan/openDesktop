## Context

- Core 已在 **macOS** 通过 Swift 子进程实现 **`native-accessibility-tree`** 与 **`native-accessibility-at-point`**，并在 **`GET /v1/version`** 的 **`capabilities`** 中仅在 **darwin** 声明。
- **Windows** 上 Qt 等应用通过 **UI Automation（UIA）** 与/或 **MSAA（IAccessible / AccessibleObjectFromPoint）** 暴露无障碍信息；当前代码路径统一返回 **`PLATFORM_UNSUPPORTED`**，Studio 因此禁用「鼠标周围」等控件。
- 会话模型已具备 **`pid`**，与「按会话约束采集」一致；需避免采到其它前台应用。

## Goals / Non-Goals

**Goals:**

- 在 **win32** 上实现与现有 HTTP 路由 **同路径、同查询参数语义** 的无障碍 **按点** 采集（优先交付），返回 JSON 与 mac 侧 **字段兼容**（`role` / `title` / `value` / `children`、`truncated`、祖先链 + 局部深度）。
- 命中结果 **必须可归因到会话 `pid`**（窗口进程或元素宿主进程与 `pid` 一致或文档化等价规则），否则返回 **4xx** 与可机读码（如 **`HIT_OUTSIDE_SESSION`** 或复用现有码）。
- **`GET /v1/version`** 在 Win 实现就绪时声明 **`native_accessibility_at_point`**（及整树就绪时声明 **`native_accessibility_tree`**）。
- **可选**：**省略 `x`/`y`** 时使用 Windows 全局指针（`GetCursorPos` 或等价），与显式坐标 **优先** 规则一致。

**Non-Goals:**

- 不在本变更内要求 **Linux** 实现。
- 不保证与 mac **逐字段逐节点** 完全一致（平台角色名映射允许差异），但 SHALL **可测试** 且文档说明映射策略。
- 不引入需 **管理员权限** 的全局键盘/鼠标 **钩子** 作为默认实时路径（轮询 HTTP + 前端坐标即可）。

## Decisions

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 主 API | **UI Automation**（`IUIAutomation`，ElementFromPoint / 相关） | 仅 MSAA | UIA 信息更全、与 Qt 现代栈更一致；若 UIA 不可用可 **降级 MSAA** |
| Node 与原生互操作 | **koffi** 或 **ffi-napi** 调用 `oleacc` / `uiautomation` / `user32` | 独立 C# 子进程 | 减少进程往返与序列化成本；需处理 **COM 初始化**（`CoInitializeEx`）与 **STA/MTA** |
| PID 校验 | 从命中元素 **向上取 HWND** → `GetWindowThreadProcessId` 与 **`pid` 比较** | 仅信任 UIA 进程 ID 字段 | HWND 路径与现有会话模型对齐，便于测试 |
| 整树 vs 按点 | **先按点**，整树 **同里程碑或后续** | 一次做完 | 降低风险；规格允许分期 |
| 鼠标坐标 | **Win32 API** 在 Core 内实现，不强制 nut-js | nut-js 扩展 | 现有 `getGlobalMousePosition` 已排除非 darwin，避免引入不必要依赖 |

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| COM/UIA 初始化与 Node 事件循环死锁 | 在短生命周期内完成调用或 **worker thread**；单测用 mock |
| DPI / 感知坐标不一致 | 文档约定使用 **屏幕物理像素** 与 mac 一致；与 Electron 壳坐标对齐测试 |
| Qt 未暴露 UIA / 仅 MSAA | 实现 **降级路径**；返回可辨识错误或部分树 |
| CI 无 Windows 交互会话 | 单元测解析逻辑；集成测 **条件跳过** 或桩 DLL |

## Migration Plan

- 新代码 **默认关闭** 能力声明直至实现通过自检；发布时 **`capabilities` 与路由行为同步打开**。
- 回滚：移除 win32 分支与 `capabilities` 条目，行为回到 **`PLATFORM_UNSUPPORTED`**。

## Open Questions

- 是否在首版即实现 **`native-accessibility-tree`**（整树），或仅 **`at-point`** 即发布。
- **错误码** 是否新增 **`HIT_OUTSIDE_SESSION`** 或复用 **`VALIDATION_ERROR`**（需在 spec 中定死）。

## Testing Strategy

- **单元**：PID 校验纯函数、JSON 形态归一化、截断逻辑；Win API 失败路径映射到 HTTP 码。
- **集成**：`createApp` HTTP 测试在 **win32** 下 **skip** 或使用 mock 模块；darwin 回归不受影响。
- **位置**：与现有 `packages/core/src/http/createApp.test.ts`、`nativeAccessibility/*.test.ts` 并列或 `*.win.test.ts` 条件加载。
