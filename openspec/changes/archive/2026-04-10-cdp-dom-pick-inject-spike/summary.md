# cdp-dom-pick-inject-spike

## 概述

**一句话**：在**单一 `page` target** 上，通过 **CDP 注入**监听页面内指针事件，记录 `clientX/Y`，再经 **`DOM.getNodeForLocation` + `describeNode`** 返回节点摘要，验证「点击 → 取节点」最短链路。

**背景与动机**：`explore` 只做服务端 HTML 启发式，无法对齐用户真实点击位置；本 spike 用注入方案先打通闭环，为后续 OS 级真机拾取、多 target 扩展留接口。

**影响范围**：`packages/core` CDP 封装、`createApp` 路由、测试与 README；**不**含 Studio 可视化叠加（可选后续）。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件 |
|---|------|------|---------|
| 1 | CDP dom pick 模块 | `getNodeForLocation`、注入 arm 脚本 | `packages/core/src/cdp/domPick.ts`（或 `browserClient` 扩展） |
| 2 | HTTP | `POST .../dom-pick/arm`、`POST .../dom-pick/resolve` | `packages/core/src/http/createApp.ts` |
| 3 | 测试 | 403、空 stash、mock CDP | `packages/core/src/http/domPick.http.test.ts` |
| 4 | 文档 | arm/resolve 使用步骤与限制 | `README.md` |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|---------------------|
| 坐标来源 | 注入监听 `clientX/Y` | OS 全局钩子复杂度高，留后续变更 |
| 交互模型 | arm → 用户点窗口内 → resolve | 避免长挂起；与显式注入心智一致 |
| stash | `window.__odDomPickLast` 全局 | 最短；后续可换 storage |

### 技术细节

1. 用户先 **arm**，再切换到被测 Electron 窗口内点击；回到 Core 客户端调用 **resolve**。  
2. resolve 读取全局坐标，调用 `DOM.getNodeForLocation(x,y)`，再 `describeNode` 取摘要。  
3. 成功后清空 stash，避免重复提交。

## 验收标准

> 以 `specs/cdp-dom-pick/spec.md` 为准。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 禁止脚本 | `allowScriptExecution === false` 时 arm | **403**，不注入 |
| 2 | 会话未就绪 | 非 running / 无 CDP 时 arm | 可机读失败 |
| 3 | 无点击记录 resolve | 未点击或 stash 已清空 | **4xx**，`DOM_PICK_EMPTY` 类码 |
| 4 | 有坐标 | stash 有效且 CDP 成功 | **200**，JSON 含节点摘要 |
| 5 | 范围 | 读 design/README | 明确单 target、注入、非 OS 钩子 |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1 | CDP 封装 | getNodeForLocation + describeNode + 注入脚本 | — |
| 2 | HTTP arm/resolve | 门禁与 JSON | 1 |
| 3 | 测试 + README | 自动化 + 手动说明 | 2 |

## 测试要点

- 与 `SCRIPT_NOT_ALLOWED` 行为与既有路由一致。  
- resolve 前无 stash 必失败。  
- 回归：既有 session/agent 路由不受影响。

## 归档说明（2026-04-10）

- **可视高亮**：落地实现为在目标文档上 **注入 CSS（class）与浮动标签** 等页面内标注，以保证调试会话结束后仍可看见；**未**采用 CDP `Overlay.*` 作为面向用户的持久高亮方案（Overlay 随调试连接断开而消失，本变更未将其作为产品级实现路径）。
