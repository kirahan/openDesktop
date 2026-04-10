## Context

- **前端栈**：`packages/web` 使用 React 18 + Vite；当前会话/观测能力集中在 `App.tsx` 等大组件中，网络 SSE 以抽屉等形式存在。
- **参考**：Whistle（[avwo/whistle](https://github.com/avwo/whistle)，MIT）的 `biz/webui` 提供成熟的 Network 信息架构；实现上 **不复用其打包产物**，仅借鉴布局、密度与交互模式。
- **后端**：Core 已提供 `GET /v1/sessions/:id/network/stream`（SSE）等能力；本变更 **首版 UI 以 mock 为主**，避免阻塞视觉与交互合并。

## Goals / Non-Goals

**Goals:**

- 独立 **Network 页面/路由**，与日志流主界面解耦。
- **Whistle 式壳**：顶栏占位、可滚动请求表、可选中行高亮、右侧详情区 **Tab 条**（首版 **Overview** 有实质内容；其余 Tab 占位文案）。
- **归一化类型** `NetworkRequestRow`（或等价命名）：字段涵盖至少：稳定 `id`、序号展示、status、method、host、path/url、mime/type 占位、时间戳可选；便于日后映射 SSE 与主进程代理。
- **MIT 合规**：在 `packages/web` 或仓库 `NOTICE` 中注明 UI 参考 Whistle 并附 MIT 许可提示（与项目法务习惯一致即可）。

**Non-Goals:**

- 不实现 Whistle 全量功能（Rules、Composer、Import/Export 文件格式等）。
- 不要求首版即完成 SSE 实时接入（可作为 follow-up task）。
- 不修改 Core HTTP/SSE 协议。

## Decisions

1. **路由形态**  
   - **决策**：在 Web 应用内使用 **hash 或 path 路由** 之一增加 `#/network` 或 `/network`（与现有 `App.tsx` 路由方式一致，实现时选一种并写死）。  
   - **理由**：与「单独一页」一致；避免与 Electron 外层路由冲突时优先 hash（若当前应用已统一 path，则跟随现有）。

2. **表格实现**  
   - **决策**：首版使用 **原生 table + CSS** 或轻量 div 表格，不引入重型 data-grid，除非行数性能实测不足再评估 `react-window` 等。  
   - **备选**：`@tanstack/react-table` —— 对本 MVP 偏重，暂不默认。

3. **数据来源**  
   - **决策**：`mockNetworkRows.ts`（或内联模块）提供 **10～30 条** 静态/伪随机数据；通过单一 `getRows(): NetworkRequestRow[]` 或 React state 注入，便于单元测试与 Story 式验收。  
   - **后续**：增加 `useNetworkStream(sessionId, targetId)` 适配层，将 SSE JSON 映射为 `NetworkRequestRow`（非本变更必须交付）。

4. **样式**  
   - **决策**：优先 **CSS 文件与 CSS 变量**（颜色、行高、选中态）模仿 Whistle 的 **低密度灰白 + 蓝选中**，与现有 Web 全局样式共存；必要时 scoped class 前缀 `od-network-` 避免污染。

5. **导航入口**  
   - **决策**：在现有主导航或顶部区域增加 **「Network」** 链接触达新页；若当前无侧栏，则用顶栏 Tab/链接。  
   - **理由**：可发现性；与 proposal「独立页」一致。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 与 Whistle 像素级不一致 | 验收以 spec 的信息架构与字段为主，不追求 1:1 像素 |
| `App.tsx` 继续膨胀 | 将 Network 拆为 `pages/NetworkView.tsx` + 子组件 |
| 未来 SSE 字段与列不完全对齐 | 行模型预留 `raw?: unknown` 或扩展字段映射表 |

## Migration Plan

- 纯新增页面与路由，无数据迁移。
- 用户旧书签仍指向原控制台首页；新入口需可见。

## Open Questions

- 是否在首版即显示 **真实 session/target 选择器**（只读展示）还是整页纯 mock——建议在实现时若已有全局 session 上下文则显示，否则占位。
