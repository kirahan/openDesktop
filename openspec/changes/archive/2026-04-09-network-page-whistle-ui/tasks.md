## 1. 类型与 Mock 数据

- [x] 1.1 在 `packages/web` 定义 `NetworkRequestRow` 类型（含 `id`、status、method、host、url/path、type 等）与 `mockNetworkRows` 模块（≥5 条）
  - [x] Test: 对纯函数或选择器若有，则 Vitest；否则验收清单覆盖「列表非空」

## 2. 页面与路由

- [x] 2.1 新增 `NetworkView`（或 `pages/NetworkPage`）组件：顶栏 + 左表 + 右详 + 底栏 filter；样式类名前缀避免全局污染
  - [x] Test: 若有 `@testing-library/react` 则渲染测试；否则文档化手动验收
- [x] 2.2 在 `App.tsx`（或 web 入口）注册独立路由/视图切换，并增加「Network」导航入口
  - [x] Test: 手动验收：可从主界面进入 Network 且 URL/hash 可区分

## 3. 交互与详情

- [x] 3.1 实现行选中态与右侧 **Overview** 键值展示（至少 URL、Method）；**Inspectors** / **Timeline** Tab 占位
  - [x] Test: 选中行后 Overview 更新（组件测试或手动验收）

## 4. 过滤与合规文档

- [x] 4.1 底部 filter 输入：对 mock 列表做前端字符串过滤，或 no-op 但可聚焦并注明
  - [x] Test: 过滤逻辑若有则单测；否则验收 AC
- [x] 4.2 添加 Whistle MIT 参考说明：`packages/web/README.md` 或根 `NOTICE` 择一或并存
  - [x] Test: 无

## 5. 可选后续（不纳入本变更完成标准）

- [ ] 5.1 将 `GET .../network/stream` SSE 适配为 `NetworkRequestRow` 并替换 mock
