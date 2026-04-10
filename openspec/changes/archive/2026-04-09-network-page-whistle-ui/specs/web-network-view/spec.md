## ADDED Requirements

### Requirement: 独立 Network 页面可访问

系统 SHALL 在 OpenDesktop Web 控制台提供独立于「日志/控制台主视图」的 **Network 专用视图**，用户 SHALL 能通过明确的导航入口（链接或按钮）从主界面进入该视图，且浏览器历史（hash 或 path）可区分该页面与默认首页。

#### Scenario: 进入 Network 页面

- **WHEN** 用户点击导航中的 Network 入口
- **THEN** 界面切换为 Network 布局（见下条），且不与日志流共用同一主内容区为唯一展示方式

### Requirement: Whistle 式双栏布局与顶栏

Network 视图 SHALL 采用 **顶栏工具区** + **主区分栏**：左侧为请求列表区域，右侧为选中请求的详情区域。顶栏 SHALL 包含若干操作占位（如 Clear、Pause/Record 语义占位，可为禁用或 no-op），视觉密度与对齐方式参考成熟 Network 工具（如 Whistle）。首版不要求顶栏按钮全部可用，但 SHALL 占位布局完整。

#### Scenario: 布局结构可见

- **WHEN** 用户打开 Network 页面
- **THEN** 用户可见顶栏、左侧列表区域、右侧详情区域三区划分清晰（可见分隔或背景区分）

### Requirement: 请求表列与选中态

左侧请求表 SHALL 以表格或语义化行列表展示多条请求；列 SHALL 至少包含：**序号**、**HTTP 状态或结果**、**Method**、**Host**、**URL 或路径**、**资源类型（Type）** 中与实现一致的子集；暂无数据的列 MAY 显示「—」。用户 SHALL 能通过点击选中一行；选中行 SHALL 有可见高亮样式。

#### Scenario: 选中行更新详情

- **WHEN** 用户点击表中某一请求行
- **THEN** 该行呈现选中态，且右侧详情区展示该请求对应内容（见 Overview 要求）

### Requirement: 详情区 Tab 与 Overview

右侧详情区 SHALL 提供 **Tab 标签栏**，标签名至少包含：**Overview**、**Inspectors**、**Timeline**（名称可英文，与常见 DevTools 一致）；首版 **Overview** Tab SHALL 展示当前选中请求的关键信息（键值形式），至少包含 **URL** 与 **Method**；其余 Tab MAY 展示固定占位文案（如「即将推出」），SHALL NOT 伪造动态数据。

#### Scenario: Overview 展示选中请求

- **WHEN** 用户已选中一行且 Overview 为当前 Tab
- **THEN** 用户可见该行的 URL 与 Method 展示

### Requirement: 底部过滤输入

Network 页面 SHALL 在列表区域附近提供 **文本过滤输入框**（占位符可类似「Filter」）；首版 MAY 仅对当前 mock 列表做前端字符串过滤或 no-op，但控件 SHALL 可见且可聚焦。

#### Scenario: 过滤控件存在

- **WHEN** 用户查看 Network 页面列表区域
- **THEN** 存在可聚焦的过滤输入控件

### Requirement: Mock 数据与行模型

系统 SHALL 使用 **明确的 TypeScript 类型**（如 `NetworkRequestRow`）描述列表中的一行；SHALL 提供 **mock 数据**（不少于 5 条）用于开发与验收，且不依赖真实 SSE。类型 SHALL 包含稳定字段 `id`（字符串），以便未来与 SSE 事件合并或去重。

#### Scenario: 无后端亦可展示列表

- **WHEN** Core 未连接或 SSE 未开启
- **THEN** Network 页面仍 SHALL 展示基于 mock 的完整列表与可选中行为

### Requirement: 第三方 UI 参考声明

项目 SHALL 在 `packages/web` README 片段或仓库 `NOTICE`（二选一或同时）中说明：Network 页面布局 **参考** 开源项目 Whistle（MIT），并包含版权与许可提示，满足 MIT 署名惯例。

#### Scenario: 文档可追溯

- **WHEN** 维护者阅读上述文档文件
- **THEN** 可识别 Whistle 为 UI 参考来源及 MIT 许可
