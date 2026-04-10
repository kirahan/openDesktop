## Why

当前 Web 控制台里网络观测与日志等能力挤在同一套界面中，信息形态差异大（请求表 vs 文本流），不利于高频扫视与下钻。未来还将接入主进程代理流量，需要与渲染进程 CDP 观测共用同一套 **Network 工作台** 心智模型。[Whistle](https://github.com/avwo/whistle) 的 Network 页在信息密度与布局上已是成熟范式；其 MIT 许可允许我们在实现上参考其 UI 结构。本变更先把 **独立 Network 页 + Whistle 式壳层** 落地，数据层以 mock 或可插拔适配为主，避免与真实 SSE 强耦合阻塞 UI 迭代。

## What Changes

- 在 `packages/web` 增加 **独立路由/页面**：专用于 Network，不再与「日志/控制台」混排为唯一入口（现有抽屉等可保留或逐步收敛，本变更以新增页面为主）。
- 实现 **Whistle 启发的 UI 壳**：顶栏工具区占位、左侧请求表、右侧详情多 Tab（首版以 Overview 为主，其余 Tab 可占位）、底部过滤输入等；列与交互尽量对齐常见 Network 工具（序号、状态、Method、Host、URL、Type 等），暂无数据的列显式空状态或「—」。
- 引入 **归一化的行模型（TypeScript 类型）** 与 **假数据 / 静态样例**，用于开发与视觉验收；预留接入 `GET .../network/stream` SSE 的适配边界（本变更不强制完成 SSE 接线，可在 tasks 中拆分为后续 task）。
- 在仓库中 **记录对 Whistle UI 的参考说明**（如 `NOTICE` 或 Web 包 README 片段），满足 MIT 署名习惯。

## Capabilities

### New Capabilities

- `web-network-view`：OpenDesktop Web 端独立 Network 页面、Whistle 式布局与交互壳、行模型与 mock 数据、为后续 CDP/代理数据源预留扩展点。

### Modified Capabilities

- （无）不修改既有 `cdp-network-observability` / `cdp-observability-sse-streams` 的规范性要求；本变更以前端呈现为主，后端契约不变。

## Impact

- **代码**：`packages/web`（路由、页面组件、样式、类型）；可能新增 `NOTICE` 或文档片段。
- **依赖**：无强制新运行时依赖（若引入轻量表格/虚拟列表，在 design 中论证）。
- **用户体验**：导航增加「Network」入口；与现有观测抽屉并存直至后续收敛。
