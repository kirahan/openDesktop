## Why

在 Windows 上观测 **Qt 等无 CDP 页面** 的会话时，需要与 macOS **同一套 HTTP 契约**（整树与按点局部树、`GET /v1/version` 能力探测），否则 Studio 无法可靠声明能力、用户也无法用「原生无障碍」路径排障。主规格里 **`native-accessibility-at-point` 仍以「仅 macOS」表述为主**，与当前实现方向不一致，需要通过本变更把 **Windows 路径（UI Automation + PID 校验 + 可选全局鼠标坐标）** 正式写入规格并固化设计决策。

## What Changes

- **Core（Windows）**：以 **PowerShell + .NET UI Automation** 为实现载体（随 `packages/core` 发布脚本），对 **`native-accessibility-tree`** 与 **`native-accessibility-at-point`** 提供与 mac 对齐的 JSON 成功/错误形态；命中点 SHALL 校验 **`AutomationElement` 与会话 `pid` 一致**（`HIT_OUTSIDE_SESSION` 等）。
- **`GET /v1/version` → `capabilities`**：在 **`win32`** 且实现就绪时声明 **`native_accessibility_tree`** 与 **`native_accessibility_at_point`**，与接口真实可用性一致。
- **全局鼠标坐标（可选、按平台）**：在未传显式 `x`/`y` 时，**darwin** 沿用 **nut-js**；**win32** 使用已文档化的 Win32 路径（如 **GetCursorPos**，经 PowerShell 或等价实现），失败时返回 **`MOUSE_POSITION_UNAVAILABLE`**，不得伪成功。
- **MSAA**：作为 **可选补充** 仅在设计中间述（不作为首版强制验收）；主路径为 **UIA**。

## Capabilities

### New Capabilities

- （无独立新能力目录名；行为归入下列既有能力的 delta。）

### Modified Capabilities

- **`native-accessibility-at-point`**：将「仅 macOS」扩展为 **darwin 与 win32** 的按点局部无障碍接口；区分 **鼠标坐标来源**（nut-js vs Win32）；更新 **能力探测** 与 **403/422** 语义以覆盖 **UIA 加载失败** 等。
- **`native-accessibility-tree`**：主规格已含 win32 与 UIA 方向；本变更若仅需交叉引用，可在 tasks 中做一次 **对账**（reconcile），无新增需求则 delta 可省略或仅 ADDED 澄清句。

## Impact

- **代码**：`packages/core`（`createApp.ts`、`*Accessibility*.test.ts`、`native-windows/*.ps1`、`getGlobalMousePosition.ts`、`winUiaTreeAtPoint.ts` 等）；**文档**：`docs/studio-shell.md` 等与能力表一致。
- **Studio**：依赖 **`capabilities`** 字符串不变；**`packages/web`** 仅需与能力探测文案一致（已有则不改）。
- **破坏性**：**无**（HTTP 路径与字段名保持与 mac 对齐；新增 win32 成功路径不视为 BREAKING）。
