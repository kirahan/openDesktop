## 1. 基础设施与能力声明

- [x] 1.1 在 `GET /v1/version` 中于 `win32` 且实现就绪时加入 `native_accessibility_at_point`（整树分期时再加 `native_accessibility_tree`）
  - [x] Test: 扩展或新增 `createApp.test.ts` 中断言 `capabilities` 在模拟/条件满足时包含对应项（darwin 回归不变）
- [x] 1.2 选定互操作方式：**PowerShell + .NET UI Automation**（`native-windows/uia-at-point.ps1`），随 `packages/core` 发布；未引入 koffi 以避免原生编译
  - [x] Test: `yarn workspace @opendesktop/core` build 与 test 通过

## 2. 鼠标坐标（可选）

- [x] 2.1 扩展 `getGlobalMousePosition.ts`：在 `win32` 使用 PowerShell 调 **GetCursorPos**
  - [x] Test: 现有 `getGlobalMousePosition.test.ts` 覆盖非 win；win 路径在集成环境验证

## 3. Windows 按点无障碍核心

- [x] 3.1 新增 `winUiaTreeAtPoint.ts` + `uia-at-point.ps1`：UI Automation **FromPoint**、局部子树与祖先链
  - [x] Test: `winUiaTreeAtPoint.test.ts`（解析 JSON / BOM / HIT_OUTSIDE_SESSION）
- [x] 3.2 **PID 校验**：PowerShell 中比对 `hit.Current.ProcessId` 与 `sessionPid`
  - [x] Test: 解析层覆盖 `HIT_OUTSIDE_SESSION` 错误 JSON

## 4. HTTP 路由与集成

- [x] 4.1 `createApp.ts`：`win32` 调用 `dumpWinAccessibilityAtPoint`
  - [x] Test: `nativeAccessibilityAtPoint.http.test.ts` mock win32 分支
- [x] 4.2 整树路由 `native-accessibility-tree` 在 `win32` 上接入 Win 整树枚举（`uia-full-tree.ps1` + `dumpWinAccessibilityTree`）
  - [x] Test: `nativeAccessibility.http.test.ts` mock win32；darwin 回归不变

## 5. 文档与收尾

- [x] 5.1 更新 `docs/studio-shell.md`：Windows UIA、PID、坐标与 capabilities
  - [x] Test: `readmeLinks` / 现有 docs 检查通过
