# studio-qt-ax-cursor-overlay Specification

## Purpose

约定 **Electron 壳内**针对 **Qt 会话**的 **AX 捕获模式**：透明覆盖层上的光标锚点、与 **`GET .../native-accessibility-at-point`** 联动的局部树展示，以及可选的 **命中区域高亮**（基于 Core 返回的 `hitFrame`）。

## Requirements

### Requirement: Qt 会话 AX 捕获模式提供树与屏幕光标锚点

当 **Studio** 运行在 **Electron 基座**（`window.__OD_SHELL__?.kind === 'electron'`）、当前选中会话 **`uiRuntime` 为 `qt`**、`GET /v1/version` 声明 **`native_accessibility_at_point`** 可用、且会话 **`state === 'running'`** 并具有 **`pid`** 时，系统 SHALL 提供 **「AX 捕获模式」**（名称 MAY 本地化），使用户能够：

1. **进入**该模式后，在屏幕上看到 **十字线或点标记**（至少一种），其位置与用于请求 **`GET /v1/sessions/:sessionId/native-accessibility-at-point`** 的 **显式屏幕坐标 `x`/`y`** 使用 **同一坐标系**（屏幕像素，与 Core 文档化语义一致）；
2. **在同一模式内**展示 **局部无障碍树**（命中节点、祖先与子树，形态与既有 at-point 响应一致或为其子集展示），失败时 SHALL 展示 Core 返回的可机读错误（含 **403** 辅助功能类）。

实现 MAY 在覆盖层上叠加 **命中区域高亮**（基于 Core 响应中的 **`hitFrame`**，经 macOS AX 几何与屏幕坐标转换）。**对齐精度、边界附近闪烁、异步更新滞后** 为已知局限，后续变更 MAY 继续改进。

#### Scenario: 进入模式后可见光标锚点与树

- **WHEN** 用户满足上述前置条件并进入 AX 捕获模式
- **THEN** 用户 SHALL 能看到十字线或点标记之一（或以上），且 SHALL 能看到与当前采样点对应的局部树内容或明确错误信息

#### Scenario: 非 Electron 基座不强制全屏层

- **WHEN** 用户在外置浏览器中使用 Studio（无 Electron shell 增强 API）
- **THEN** Studio SHALL NOT 因缺失覆盖层而崩溃；SHALL 仍允许用户通过既有方式触发 **native-accessibility-at-point**（例如按钮 + 显式坐标或文档化降级路径）

### Requirement: 对 native-accessibility-at-point 的请求须节流

在 AX 捕获模式开启且指针移动会触发刷新时，客户端 SHALL 对 **`GET .../native-accessibility-at-point`** 的调用实施 **节流或合并**（文档化默认频率上限，例如不超过 **10 次/秒**，或按位移阈值），且 SHALL NOT 在典型鼠标移动下无界高频请求 Core。

#### Scenario: 持续移动指针不产生请求风暴

- **WHEN** 用户在捕获模式下连续快速移动指针数秒
- **THEN** 客户端发出的 at-point 请求速率 SHALL 保持在文档化上限以内（或采用等价「仅变化超阈值才请求」策略）

### Requirement: 壳与 Web 的职责边界

**Electron 主进程 / preload** SHALL 负责透明覆盖窗口生命周期及向渲染进程暴露 **只读、类型稳定** 的 API（例如启动/停止覆盖、上报指针屏幕坐标、可选的高亮矩形同步）；**packages/web** SHALL 负责会话 UI、节流、发起 Core HTTP 请求与结果展示。**Core** SHALL NOT 为本能力新增专用光标 SSE 端点。

#### Scenario: 注册与观测真源仍在 Core

- **WHEN** 审查数据持久化与 AX 树内容来源
- **THEN** 应用注册与会话状态 SHALL 仍以 Core HTTP 为准；覆盖层 SHALL NOT 替代 **`GET .../native-accessibility-at-point`** 的鉴权与错误语义
