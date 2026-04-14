## Context

- **现状**：macOS 使用 Swift / AX 与 nut-js；Windows 侧采用 **无额外原生编译** 的 **PowerShell + UIA** 脚本，由 Node **spawn** 执行，环境变量传入 **PID、坐标、深度/节点上限** 等。
- **约束**：与 **`MacAxAtPointResult` / 整树 JSON** 形态对齐，便于 Studio 单一解析路径；**PID 校验**防止命中其它进程窗口。
- **规格缺口**：`openspec/specs/native-accessibility-at-point/spec.md` 仍偏 mac 叙述，需通过 **delta** 收敛后再 **reconcile** 入主规格。

## Goals / Non-Goals

**Goals:**

- **HTTP 与能力表一致**：`win32` 下 **`native_accessibility_tree`** 与 **`native_accessibility_at_point`** 与实现同步。
- **按点路径**：UIA **`FromPoint`** + **Raw/Control 视图**与现有脚本一致；**`GetParent`** 等 API 与 .NET 命名对齐，避免误用。
- **鼠标坐标**：无显式坐标时 **win32** 使用 **GetCursorPos** 类 API（实现已存在则做对账与测试补全）。
- **可测试性**：Core HTTP 测试 **mock** 子进程采集，覆盖 **`PLATFORM_UNSUPPORTED`**、**`SESSION_NOT_READY`**、**`PID_UNAVAILABLE`**、**403**、**422**。

**Non-Goals:**

- **WGC / 屏幕像素捕获** 作为命中主路径（属观测增强，另案）。
- **C++/koffi** 常驻原生扩展（与「仅 PS+UIA」决策一致，除非未来性能不足再议）。
- **MSAA 首版必达**：仅保留为后续 **fallback** 候选（见 Risks）。

## Decisions

| 决策 | 选择 | 理由 | 备选 |
|------|------|------|------|
| 无障碍 API | **UI Automation（.NET）** 为主 | 与 Qt 现代栈、角色/边界信息较完整 | MSAA 更老、信息更粗 |
| 互操作 | **PowerShell `-File` + env JSON** | 免编译、易改、与仓库同发 | koffi 调 C# |
| PID 信任 | **命中元素 `ProcessId` 与会话 `pid` 相等** | 简单可靠 | 仅 HWND 比对（需额外 API） |
| 整树根 | **桌面子级 `FindAll` + `ProcessId` 条件** | 标准 UIA 枚举顶层窗 | Raw 全树过滤（过重） |
| 鼠标 | **darwin: nut-js**；**win32: GetCursorPos** | 与平台惯例一致 | 全程 nut-js on Win（依赖重） |

**MSAA**：若 UIA 在个别宿主上返回空树，可 **记录现象** 后评估 **AccessibleObjectFromPoint** 补充；首版 **不** 写入强制 SHALL。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| PowerShell 启动与编码导致 **stderr 乱码** | 统一 UTF-8 输出约定；错误信息截断与 **可机读 code** 优先 |
| **`[ref]` 双重包装** 等 PS 陷阱 | 单元测试 + 脚本内仅顶层 `([ref]$nc)`，递归传 `$nodeCounter` |
| Qt **未导出 UIA** | 返回 **`NO_UI_ROOT` / 422** 或浅树；文档说明与 **按点** 一致 |
| **权限/完整性** 差异 | Windows 403 文案与 mac 区分；不冒充「辅助功能」开关语义 |

## Migration Plan

- 无数据迁移。发布顺序：**Core 先**（能力真值），**Studio** 仅依赖版本探测，无需强制同发。
- 回滚：移除 `capabilities` 中 win32 声明或还原路由（不推荐；优先修脚本）。

## Open Questions

- 是否在后续变更增加 **HWND 几何命中**（EnumChildWindows）作为 **UIA 失败时的降级高亮**（Explore 中讨论过，与本提案解耦）。

## MSAA spike（记录）

- **结论（占位）**：首版以 **UIA** 为主路径；若遇 **空树或极浅树** 且宿主为自绘/Qt Quick，可再评估 **`AccessibleObjectFromPoint`（MSAA）** 作补充命中；需单独变更与性能评估，本 apply 不实现。

## Testing Strategy

- **单元**：`parseMacAxAtPointStdout` / `parseMacAxTreeStdout` 与 **BOM**、错误 JSON；`getGlobalMousePosition` 在 **非 win** 行为不变。
- **HTTP**：`nativeAccessibility.http.test.ts`、`nativeAccessibilityAtPoint.http.test.ts` **mock** `dumpMac*` / `dumpWin*`，覆盖 **darwin / win32 / linux** 分支。
- **集成**：Windows 实机对 **Qt 会话** 手动验证（CI 可选跳过）；脚本错误用 **录屏 stderr** 归档。
