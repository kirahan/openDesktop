# app-runtime-qt-electron-observability

## 概述

**一句话**：为应用增加 **Electron / Qt** 运行时分类并在 Studio **打标签**；**Electron 会话**保留现有 CDP 类观测，**Qt 会话**仅突出 **整树原生无障碍** 与 **鼠标周围局部无障碍**；后者在 Core 用 **@nut-tree/nut-js** 读指针坐标，配合 **macOS AX 按点命中** 返回局部子树。

**背景与动机**：Qt 无可靠 CDP `page` 目标，观测应以 AX 为主；整树过大时需「指针附近」快速结构。当前应用模型不区分技术栈，会话观测 UI 无法分流。

**影响范围**：`packages/core`（存储、HTTP、Swift AX、nut-js）、`packages/web`（注册、标签、观测区）、`docs/API.md`；预估 **>10** 个文件，**非** quick-change。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件（预期） |
|---|------|------|------------------|
| 1 | `AppDefinition.uiRuntime` | `electron` \| `qt`，缺省 `electron` | `packages/core/src/store/types.ts`、JSON 读写 |
| 2 | 应用 API | `POST/GET /v1/apps` 接受/返回 `uiRuntime` | `createApp.ts` 或路由模块 |
| 3 | 会话列表聚合 | `GET /v1/sessions` 带 `uiRuntime` | `createApp.ts`、`SessionManager` 或 store |
| 4 | nut-js 封装 | `mouse.getPosition()`，失败映射错误码 | 新模块 `packages/core/src/...` |
| 5 | Swift AX 按点 | `AXUIElementCopyElementAtPosition` + 受限上/下枚举 | `packages/core/native-macos/*.swift` |
| 6 | HTTP `.../native-accessibility-at-point` | Query `x,y` 可选；权限与整树一致 | `createApp.ts` |
| 7 | `/v1/version` | `native_accessibility_at_point`（darwin） | `createApp.ts` |
| 8 | Studio 标签与分流 | 应用 Tag；Electron 多卡 vs Qt 两按钮 | `packages/web/src/App.tsx` 等 |
| 9 | 文档与测试 | API、HTTP 测试、Web 逻辑测试 | `docs/API.md`、`*.test.ts` |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|---------------------|
| 缺省运行时 | `electron` | 与现网「以 Electron/CDP 为主」一致，避免大规模迁移 |
| 坐标来源 | 显式 `x,y` 优先，否则 nut-js | 可测、可调试；无鼠标环境可手动传 |
| 局部树语义 | 命中 + 祖先 ≤N + 子树 ≤M | 单节点信息不足；全树与整树接口重复 |
| Qt 观测 UI | 仅两主入口 | 需求明确；避免 CDP 空操作误导用户 |

### 技术细节

```
用户点击「鼠标周围」(Qt 会话)
    → Web: GET .../native-accessibility-at-point（无 x,y）
    → Core: nut-js mouse.getPosition() → (x,y)
    → Core: Swift 子进程 pid + (x,y) → AX 命中 + 裁剪子树
    → Web: MacAxTreeVisual（或等价）展示 JSON
```

失败路径：无辅助功能 → 403 `ACCESSIBILITY_DISABLED`；无坐标且 nut-js 失败 → `MOUSE_POSITION_UNAVAILABLE`（或 422，以实现与 spec 对齐为准）。

## 验收标准

测试与产品验收以各 **`specs/*/spec.md`** 中 **Scenario** 为准，尤其：

- `app-runtime-kind`：默认 electron、列表带 `uiRuntime`、Studio 标签与 **Electron 多卡 / Qt 两入口**。
- `native-accessibility-at-point`：darwin 前置条件、坐标优先级、truncated、403/权限、nut-js 失败、version 能力、Qt 的「鼠标周围」控件。
- `app-register-bootstrap`（ADDED）：注册可选 `uiRuntime`、默认不破坏快乐路径。

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | 数据模型 | `uiRuntime` 字段与 API | — |
| 2 | 会话聚合 | 列表附带 `uiRuntime` | 1 |
| 3 | nut-js | 依赖与封装 | — |
| 4 | Swift 按点 | AX 命中与裁剪 | — |
| 5 | HTTP + version | 新路由与 capabilities | 3、4 |
| 6 | 文档与测试 | API、http test、mock | 5 |
| 7 | Studio | 标签、注册、观测分流 | 1、2 |
| 8 | 回归 | core/web 测试全绿 | 7 |

## 测试要点

- HTTP：**非 darwin**、会话缺失、未运行、无 pid、403 辅助功能、nut-js 失败且无坐标、成功 mock。
- Web：**electron** 与 **qt** 会话观测区结构差异；Qt 两按钮启用条件。
- 不在 CI 依赖真实桌面鼠标位置（mock nut-js）。
