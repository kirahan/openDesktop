## 完成验证记录

以下任务均在仓库内**有对应实现或测试**，并在 **`yarn workspace @opendesktop/core run test`** 全量通过（当前 **306** 条）后勾选。若你本地数字不一致，请先 `git pull` 再跑测试。

| 节 | 验证要点 |
|----|-----------|
| 1 | 主规格 `openspec/specs/native-accessibility-at-point/spec.md` 含 Purpose 与 darwin/win32 条款 |
| 2 | `createApp.ts` 中 `capabilities`；`createApp.test.ts` 按平台断言 |
| 3 | `native-windows/uia-*.ps1` 存在；解析与 HTTP mock 覆盖 |
| 4 | `getGlobalMousePosition.ts` win32 路径；`getGlobalMousePosition.win32.test.ts` mock `execFile` |
| 5 | `nativeAccessibility*.http.test.ts` 双平台与错误码 |
| 6 | `docs/studio-shell.md`、`docs/API.md`；`readmeLinks.test.ts` |
| 7 | `design.md` 中 MSAA 结论段（非代码） |

---

## 1. 规格与对账

- [x] 1.1 将本变更中 **`native-accessibility-at-point`** delta 合并入主规格 `openspec/specs/native-accessibility-at-point/spec.md`（含 Purpose 段落在内，与 **darwin + win32** 一致）
  - [x] Test: `readmeLinks.test.ts`；主规格全文无「仅 macOS」作为唯一平台表述

## 2. Core 能力与路由

- [x] 2.1 核对 **`GET /v1/version` → `capabilities`**：在 **`win32`** 列出 **`native_accessibility_tree`** 与 **`native_accessibility_at_point`** 当且仅当实现可用
  - [x] Test: `createApp.test.ts`（`win32` 含两项、`linux` 不含）

## 3. Windows 采集实现

- [x] 3.1 核对 **`packages/core/native-windows/uia-at-point.ps1`**：**`GetParent`**、**`[ref]`** 计数、**`HIT_OUTSIDE_SESSION`** 与 JSON 形态
  - [x] Test: `winUiaTreeAtPoint.test.ts`；`nativeAccessibilityAtPoint.http.test.ts`（含 **`HIT_OUTSIDE_SESSION`**）

- [x] 3.2 核对 **`uia-full-tree.ps1`**：**PID 顶层枚举**、**`ElemToNode`** 与 **`NO_UI_ROOT`**
  - [x] Test: `nativeAccessibility.http.test.ts`（win32 成功 + **`NO_UI_ROOT` → 422**）

## 4. 全局鼠标（win32）

- [x] 4.1 核对 **`getGlobalMousePosition.ts`**：在 **`win32`** 使用 **GetCursorPos** 路径；失败码 **`MOUSE_POSITION_UNAVAILABLE`**
  - [x] Test: `getGlobalMousePosition.test.ts`（darwin/linux）；**`getGlobalMousePosition.win32.test.ts`**（mock 成功与解析失败）

## 5. HTTP 集成

- [x] 5.1 核对 **`native-accessibility-at-point`** 路由：**darwin** / **win32** 分支与查询参数
  - [x] Test: `nativeAccessibilityAtPoint.http.test.ts`（linux、darwin、win32 含 **`hitFrame`**、鼠标失败、**403** 等）

- [x] 5.2 核对 **`native-accessibility-tree`** 路由：**win32** 调 **`dumpWinAccessibilityTree`**
  - [x] Test: `nativeAccessibility.http.test.ts`（win32 200、**NO_UI_ROOT**）

## 6. 文档

- [x] 6.1 **`docs/studio-shell.md`**、**`docs/API.md`**：Windows、UIA、PID、坐标与 **capabilities**
  - [x] Test: `readmeLinks.test.ts`

## 7. 可选后续（非本变更验收）

- [x] 7.1 **MSAA** spike 结论写在 **`design.md`**「MSAA spike（记录）」节；不实现代码
