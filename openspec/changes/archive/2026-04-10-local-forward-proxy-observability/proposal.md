## Why

现有 **CDP Network + SSE** 能很好地观测**渲染进程页面**发起的 HTTP(S)，但 **Electron/Node 主进程**及未走 Chromium 网络栈的 HTTP(S) 不会出现在该通道中。为与 **Whistle** 机制对齐、便于后续扩展规则与插件式管道，需要引入**本地 HTTP(S) 转发代理 + 规则 + 观测事件**，与现有观测**并存**且**事件模型对齐**。首期聚焦 **不解密 HTTPS（不做 MITM）** 的可交付路径，**MITM 根证书与动态签发**作为明确后续阶段，在设计与任务中预留 TODO。

## What Changes

- 引入 **本地 HTTP(S) 转发代理**（监听本机端口），支持 **HTTP** 与 **HTTPS CONNECT** 隧道；**首期不对 HTTPS 做 MITM 解密**，仅可依赖 CONNECT/明文 HTTP 可得的元数据（及后续可扩展的侧信道）形成观测事件。
- 建立 **规则层占位/最小实现**（与 Whistle 式「pattern → action」演进方向一致），首期以 **过滤、转发、可观测标记**为主，为后期规则扩展留扩展点。
- 建立 **观测事件管道**（落库或内存流），事件字段与现有 **CDP Network / network SSE** 的 `NetworkRequestRow`（或等价 canonical 模型）**对齐**，并标注 **来源：CDP | PROXY**，便于 Studio 合并展示。
- 在 **已注册应用**配置中增加 **「启动时启用本应用专用代理」** 开关；开启时 **仅在该应用启动流程中**注入 `HTTP_PROXY`/`HTTPS_PROXY`（及 `NO_PROXY` 策略），**不修改系统全局代理**。
- **设计文档与 tasks** 中明确记录 **Phase 2：MITM 解密 HTTPS**（本地根 CA、按域名动态证书、信任安装流程、与 Certificate Pinning 降级策略），以 TODO/后续里程碑形式列出，**不在首期实现代码路径中落地**。

## Capabilities

### New Capabilities

- `local-forward-proxy`：本地转发代理生命周期、HTTPS CONNECT/HTTP 处理、规则钩子（首期最小集）、观测事件与 CDP 模型对齐、已注册应用级代理开关与启动注入、**Phase 2 MITM 的占位与 TODO**。

### Modified Capabilities

- （无）本变更以新增能力为主；与现有 `cdp-observability-sse-streams` / `cdp-network-observability` **并存**，不在首期修改其规范条文，仅在设计层约定事件模型对齐与 UI 合并策略。

## Impact

- **Core / 宿主**：代理进程或与会话绑定的子进程、端口分配、与现有 HTTP API 的鉴权关系。
- **应用启动器 / 已注册应用**：进程级环境变量注入、与 Profile/Session 的关联字段。
- **Studio / Web**：已注册应用详情或配置页上的开关；网络观测 UI 可选展示 PROXY 来源事件（与 CDP 并列或合并）。
- **依赖**：可能引入或嵌入现有 Node 生态代理组件（选型在 design 中确定）；**首期无本地根证书安装流程**。