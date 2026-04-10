# network-page-whistle-ui

## 概述

**一句话**：在 `packages/web` 增加独立 **Network** 页面，采用 Whistle 启发的双栏 + Tab 壳层与 mock 数据，为后续 SSE/代理数据源接入预留行模型。

**背景与动机**：网络请求表与日志流信息形态不同，混排不利于扫视与下钻；未来主进程代理与 CDP 观测需共用同一 Network 工作台。Whistle（MIT）的 Network UI 是成熟参考，本变更先落 **页面与壳**，数据以 mock 为主，避免阻塞前端迭代。

**影响范围**：主要 `packages/web`（新页面组件、路由/视图切换、类型与 mock、样式）；可选 `NOTICE` 或 Web README；预估新增/修改若干 TSX/CSS 文件。

## 设计方案

### 改动点

| # | 改动 | 说明 | 涉及文件 |
|---|------|------|----------|
| 1 | `NetworkRequestRow` 与 mock | 稳定 `id`，≥5 条样例 | `packages/web/src/...`（路径实现时定） |
| 2 | `NetworkView` 布局组件 | 顶栏、左表、右详 Tab、底栏 filter | 同上 |
| 3 | 路由与导航 | 独立 hash/path，入口链接 | `App.tsx` 或路由入口 |
| 4 | MIT 参考说明 | Whistle 署名 | `packages/web/README.md` 或根 `NOTICE` |

### 关键决策

| 决策 | 选择 | 为什么不选其他方案 |
|------|------|---------------------|
| 数据首版 | Mock 静态/伪随机 | SSE 接线可作为独立 task，不阻塞 UI 合并 |
| 表格实现 | 原生 table + CSS | 避免过早引入重型表格库 |
| 参考合规 | README/NOTICE 注明 Whistle MIT | 满足 MIT 署名；不 fork 整库 |

### 技术细节

- **布局**：顶栏占位按钮 → 下方 flex/grid **左表右详**；左表可滚动，右详 **Tab**：Overview 有实内容，其余占位。
- **状态**：选中 `rowId` 驱动右侧 Overview；filter 对 mock 数组 `filter`（或 noop）。
- **后续扩展**：SSE 适配器将事件映射为 `NetworkRequestRow`，合并进列表 state。

## 验收标准

> 测试与产品验收以本节为准（来自 spec）。

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 独立 Network 页面 | 点击导航 Network 入口 | 进入专用视图，与日志主区解耦，历史可区分 |
| 2 | 三区布局 | 打开 Network 页 | 可见顶栏、左列表、右详情 |
| 3 | 表列与选中 | 点击某行 | 行有高亮，右侧显示对应详情 |
| 4 | Overview | 选中行且 Overview 激活 | 可见 URL、Method |
| 5 | 其他 Tab | 切换 Inspectors/Timeline | 可为占位，不伪造动态数据 |
| 6 | 过滤框 | 查看列表区 | 存在可聚焦过滤输入 |
| 7 | Mock 离线 | 无 Core/SSE | 仍有 ≥5 条数据且可选中 |
| 8 | 合规文档 | 读 README 或 NOTICE | 可见 Whistle 参考与 MIT 提示 |

## 实现清单

| # | 任务 | 说明 | 依赖 |
|---|------|------|------|
| 1.1 | 类型与 mock | `NetworkRequestRow` + mock | — |
| 2.1 | NetworkView 组件 | 布局与样式 | 1.1 |
| 2.2 | 路由与导航 | 入口与切换 | 2.1 |
| 3.1 | 选中 + Overview + Tab 占位 | 交互与详情 | 2.1 |
| 4.1 | Filter | 前端过滤或 no-op | 2.1 |
| 4.2 | MIT 说明 | 文档 | — |
| 5.1 | （可选）SSE 适配 | 替换 mock | 2.x |

## 测试要点

- 列表非空、选中切换、Overview 字段正确；filter 行为与实现一致。
- 回归：原首页与现有观测抽屉仍可访问（若保留）。
- 无 RTL 时以手动验收 + `tasks` 中注明的 Vitest 为准。
