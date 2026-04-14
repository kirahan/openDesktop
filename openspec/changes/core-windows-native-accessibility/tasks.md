## 1. 规格与对账

- [x] 1.1 将本变更中 **`native-accessibility-at-point`** delta 合并入主规格 `openspec/specs/native-accessibility-at-point/spec.md`（含 Purpose 段落在内，与 **darwin + win32** 一致）
  - [x] Test: `readmeLinks` 或文档链接检查通过；人工核对 Purpose 与 Requirements 无「仅 macOS」残留矛盾句

## 2. Core 能力与路由

- [x] 2.1 核对 **`GET /v1/version` → `capabilities`**：在 **`win32`** 列出 **`native_accessibility_tree`** 与 **`native_accessibility_at_point`** 当且仅当实现可用
  - [x] Test: `createApp.test.ts` 按平台断言（含 win32 含两项、linux 不含）

## 3. Windows 采集实现

- [x] 3.1 核对 **`packages/core/native-windows/uia-at-point.ps1`**：**`GetParent`**、**`[ref]`** 计数、**`HIT_OUTSIDE_SESSION`** 与 JSON 形态
  - [x] Test: `winUiaTreeAtPoint.test.ts` 解析层；HTTP mock 覆盖 **`HIT_OUTSIDE_SESSION`**

- [x] 3.2 核对 **`uia-full-tree.ps1`**：**PID 顶层枚举**、**`ElemToNode`** 与 **`NO_UI_ROOT`**
  - [x] Test: `nativeAccessibility.http.test.ts` mock **`dumpWinAccessibilityTree`** win32 成功路径

## 4. 全局鼠标（win32）

- [x] 4.1 核对 **`getGlobalMousePosition.ts`**：在 **`win32`** 使用 **GetCursorPos** 路径；失败码 **`MOUSE_POSITION_UNAVAILABLE`**
  - [x] Test: `getGlobalMousePosition.test.ts` 非 win 行为不变；win 路径在现有测试中 mock 或文档化跳过说明

## 5. HTTP 集成

- [x] 5.1 核对 **`native-accessibility-at-point`** 路由：**darwin** 调 **`dumpMacAccessibilityAtPoint`**，**win32** 调 **`dumpWinAccessibilityAtPoint`**，参数与查询串一致
  - [x] Test: `nativeAccessibilityAtPoint.http.test.ts` 已 mock 双平台；补全缺失分支断言（若缺口）

- [x] 5.2 核对 **`native-accessibility-tree`** 路由：**win32** 调 **`dumpWinAccessibilityTree`**
  - [x] Test: `nativeAccessibility.http.test.ts` win32 用例

## 6. 文档

- [x] 6.1 更新 **`docs/studio-shell.md`**（或等价文档）：Windows、UIA、PID、坐标与 **capabilities**
  - [x] Test: `readmeLinks.test.ts` 通过

## 7. 可选后续（非本变更验收）

- [x] 7.1 Spike：**MSAA** 在 UIA 空树时的 **`AccessibleObjectFromPoint`** 可行性（仅记录结论于 design 或 issue，不强制代码）
