# studio-qt-ax-cursor-overlay

## 概述

**一句话**：在 **Electron 基座**上为 **Qt 会话**增加 **AX 捕获模式**——全屏透明层显示 **十字线/点标记**，与 **`native-accessibility-at-point`** 返回的 **局部树**联动；MVP **不包含**控件矩形几何。

**背景与动机**：Qt 无 DOM/CDP，观测依赖系统 Accessibility。已有按点拉树 API，但缺少与指针对齐的视觉锚点。Electron 透明窗口可补这一层，接近 Electron 应用内「指哪看哪」的体验。

**影响范围**：`packages/studio-electron-shell`、`packages/web`；**Core HTTP 无行为变更**（复用现有 at-point）。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件（预期） |
|---|------|------|------------------|
| 1 | 透明覆盖窗口 | 全屏透明 BrowserWindow，绘十字线/点 | `packages/studio-electron-shell/src/main.js`（及可能拆分模块） |
| 2 | Shell IPC / preload | 启停覆盖、上报屏幕坐标 | `packages/studio-electron-shell/src/preload.cjs` |
| 3 | Qt 捕获模式 UI | 入口、节流请求 at-point、树展示 | `packages/web/src/App.tsx` 或会话观测相关模块 |
| 4 | 测试 | 节流与无壳降级 | `packages/web` 内 `*.spec.ts` / `*.test.ts` |
| 5 | 文档 | 行为说明与 API 无变更声明 | `docs/studio-shell.md` 或 `docs/API.md` 片段 |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|-------------------|
| 几何信息 | 仅十字线/点，不要 frame | 避免 Swift/AX 协议扩展，缩短 MVP |
| 坐标来源 | Overlay 与 at-point **显式 x,y 同源** | 避免 nut-js 与绘制层不一致 |
| 基座 | 浏览器不强制 overlay | 保持 Node+浏览器路径可用 |

### 技术细节

- 数据流：**指针移动** →（节流）→ Web 用 **`x`,`y`** 调 **`GET /v1/sessions/:id/native-accessibility-at-point`** → 树视图更新；overlay 仅负责 **视觉锚点**。
- Core：**不**新增 SSE；鉴权与错误码与现有一致。

## 验收标准

> 以 `specs/studio-qt-ax-cursor-overlay/spec.md` 与 `specs/studio-shell-host/spec.md` 增量为准。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | Electron + Qt + 能力就绪 | 进入 AX 捕获模式 | 可见十字线或点；可见局部树或 Core 错误 |
| 2 | 浏览器无壳 | 打开 Studio | 不崩溃；仍可通过既有方式触发 at-point |
| 3 | 快速移动指针 | 捕获模式下持续移动鼠标 | at-point 请求被节流，无请求风暴 |
| 4 | 真源 | 任意基座 | 树内容与鉴权仍以 Core HTTP 为准 |
| 5 | Electron 退出 | 退出应用 | 覆盖窗口释放，无残留透明顶层窗 |
| 6 | 非目标 | — | 不绘制控件矩形、不依赖本变更扩展 AX frame |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | Spike 透明层与输入策略 | 验证 Electron API 组合 | — |
| 2 | preload / 主进程 API | 启停与坐标契约 | 1 |
| 3 | Web 捕获模式 + 节流 | UI + HTTP 调用 | 2 |
| 4 | 测试与文档 | 单测 + 用户/开发文档 | 3 |

## 测试要点

- 无 `__OD_SHELL__` 时 Web 路径不回归。
- 节流逻辑有断言（时间或次数上界 mock）。
- 若有壳集成测试，仅作可选（Electron E2E 成本高）。
