## Context

- **现状**：Core 在 macOS 上提供 **`GET /v1/sessions/:sessionId/native-accessibility-at-point`**（显式 `x`/`y` 或 nut-js 读鼠标），返回命中节点、祖先链与局部子树；Studio Web 对 Qt 会话已有「鼠标周围拉取」类入口（见 `native-accessibility-at-point` / `nativeAccessibilityObservability.ts`）。
- **缺口**：用户缺少**屏幕上的视觉锚点**（十字线或点），难以将树与「指针下」的 Qt 控件对应；Electron 基座可提供**全屏透明窗口**解决覆盖绘制，而无需改 Qt 应用本身。
- **约束**：业务真源仍在 Core + Web；壳仅提供原生窗口与输入路由。

## Goals / Non-Goals

**Goals:**

- MVP：**局部 AX 树** + **屏幕坐标系下的十字线或点标记**（二选一或可同时存在，以实现为准），与 at-point 请求使用**同一套屏幕像素坐标**。
- 请求频率 **节流**（例如 mousemove 合并为 ≤10 Hz 或可配置），避免打爆 Core。
- Electron 与浏览器基座 **行为可区分**：无壳时保留「按钮 + 显式坐标/读数」路径，不强制全屏层。

**Non-Goals:**

- **不在**本变更中要求 AX 响应包含 **`frame`/矩形**；不在 overlay 上绘制**控件边框**。
- **不在**本变更中实现 Windows UI Automation 等价覆盖（范围仅限文档化支持的 macOS + darwin 能力）。
- **不在** Core 内新增「光标订阅」SSE（仍用 HTTP 轮询/按需请求）。

## Decisions

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 坐标真源 | 透明层内跟踪的 **屏幕坐标** → 作为 at-point 的 **显式 `x`,`y`** | 仅依赖 Core nut-js 读鼠标 | 显式坐标与绘制位置**同源**，避免 nut-js 与 overlay 不同步 |
| 覆盖窗口形态 | 独立 **全屏透明 `BrowserWindow`**（每显示器或主屏，以实现为准） | 嵌入主窗口 canvas | 全屏与 Qt 窗口叠放更简单；主窗口不必改布局 |
| 点击穿透 | 捕获模式下 **`setIgnoreMouseEvents`** 等：**移动**仍送达 overlay（或主进程全局监听），**点击**穿透至下层 Qt | 不穿透 | MVP 需能操作 Qt；具体 API 以 Electron 平台行为为准并做**Spike** |
| Web ↔ Shell | **preload `contextBridge`** 暴露：`startQtAxOverlay` / `stop` / 事件 `cursor-move`（或单次轮询 IPC） | CDP | 与现有 shell 模式一致，不引入新协议 |
| 节流 | 渲染进程 **requestAnimationFrame** 或 **定时器** 合并位移；仅当坐标变化超过阈值时请求 | 每 move 请求 | 保护 Core 与 Swift 子进程 |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Retina / 多显示器坐标与 AX 不一致 | 实现阶段用固定用例对照 Core 返回的 `screenX`/`screenY` 与 overlay 读数；文档记录「与 at-point 一致」 |
| `setIgnoreMouseEvents` 行为因 Electron 版本而异 | 小步 Spike；必要时降级为「仅热键采样点」而非连续跟踪 |
| 用户忘记退出捕获模式 | 明显退出按钮；会话停止或切走时自动 `stop` |
| 浏览器基座无 overlay | 保留现有 at-point 按钮流；文案说明 |

## Migration Plan

- 新能力默认**关闭**，由用户显式进入「捕获模式」。
- 无数据库迁移；仅发版 Shell + Web。

## Open Questions

- 覆盖窗口是否**限定在会话前台应用所在显示器**（需窗口几何 API）还是始终主屏全屏？
- 十字线样式（颜色/粗细）是否要做**主题/对比度**可访问性选项？
