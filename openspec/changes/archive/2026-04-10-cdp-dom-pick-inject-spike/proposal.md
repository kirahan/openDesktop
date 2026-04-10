## Why

需要在**被调试的 Electron 页面**上验证「点击位置 → DOM 节点」的最短链路，为后续「真机点窗口 / 多 target / 录制」打基础。当前 Agent `explore` 仅服务端解析 HTML，**无法在用户真实点击处**解析节点；本变更以 **CDP 注入 + `DOM.getNodeForLocation`** 在 **单会话、单 page target** 下打通闭环。

## What Changes

- 新增经鉴权的 **会话 + target** 子资源：在 **arm** 阶段向目标页 **注入** 轻量脚本（`capture` 阶段监听 `click`/`pointerdown`），将 **`clientX` / `clientY`** 写入约定全局；在 **resolve** 阶段由 Core 读取 stash 并调用 **`DOM.getNodeForLocation`**（及最小 **`DOM.describeNode` 或等价**）返回可机读的节点摘要（如 `nodeName`、`id`、`class`、外层 HTML 截断）。
- **显式**两阶段（先 arm、用户在被测窗口内点击、再 resolve），避免长轮询 CDP 事件与全局 OS 钩子。
- **Non-goals（本 spike）**：操作系统级全局鼠标、多 target 自动路由、iframe 子 frame 专项命中、稳定 CSS selector 生成、Studio 可视化叠加层。

## Capabilities

### New Capabilities

- **`cdp-dom-pick`**：基于注入的页面内坐标拾取与 CDP 节点解析（单 target、Phase 1）。

### Modified Capabilities

（无）

## Impact

- **Core**：`createApp` 或观测路由旁新增 `dom-pick` HTTP；`browserClient` 或新模块封装 `DOM.enable` + `DOM.getNodeForLocation` + `Runtime.evaluate`（注入/读 stash）；与 **`allowScriptExecution`**、会话 **`running`** 对齐。
- **测试**：HTTP 集成测试（可 mock CDP 层）或单元测试；**手动**：本地 Electron + 单窗口点选。
- **文档**：README 或开发者小节简述 arm/resolve 与限制。
