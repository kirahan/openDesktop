## 1. 设计与契约

- 1.1 在 Core（或独立包）中确定代理 **进程模型**、**端口分配**、**仅 loopback 监听** 的默认配置
- 1.2 定义并实现 **proxy 来源** 观测事件的 **canonical JSON**（与现有 CDP `NetworkRequestRow` / SSE 事件对齐，含 `source: "proxy"`、`tlsTunnel`）
- 1.3 文档化 **NO_PROXY** 默认值（含 Core 端口排除），避免回环

## 2. 代理核（Phase 1，无 MITM）

- 2.1 实现 **HTTP** 转发与基础观测（method、url、status、耗时）
- 2.2 实现 **HTTPS CONNECT** 隧道（不解密），产生 **tlsTunnel: true** 的观测事件（host:port、字节计数或等价元数据）
- 2.3 （可选）选型或封装现有 Node 代理库；**禁止** 在本期合并 MITM 相关依赖路径

## 3. 规则层（最小）

- 3.1 实现 **host**（及可选 **path 前缀**）匹配与 **标签** 注入到观测事件
- 3.2 为后续 Whistle 式脚本规则预留 **扩展接口**（空实现或 noop 即可）

## 4. 已注册应用与启动注入

- 4.1 在 **已注册应用** 数据模型与 UI 中增加 **「启动时使用专用代理」** 开关
- 4.2 在应用 **启动路径** 中注入 `HTTP_PROXY`/`HTTPS_PROXY`（及 `NO_PROXY`）；验证 **不写入系统全局代理**
- 4.3 验收：多应用间开关 **互不影响**

## 5. Studio / 可观测性集成

- 5.1 将 proxy 事件接入现有观测管道（SSE / API 形式与 `registerObservability` 或等价模块对齐，具体在实现时定稿）
- 5.2 Web 或 Studio UI **可区分** `source: cdp` 与 `source: proxy`（最小：列或筛选）

## 6. 测试与文档

- 6.1 自动化测试：HTTP 经代理的观测事件字段；CONNECT 隧道事件含 `tlsTunnel`
- 6.2 手动验收清单：已注册应用开关、进程级环境变量、非全局代理
- 6.3 更新 README 或开发者文档：两阶段边界、**Phase 2 MITM** 指向本节第 7 组任务

## 7. Phase 2 — HTTPS MITM 与丰富接口信息（TODO / 后续变更，本期不实现）

> **说明**：以下任务 **本期不实现**，仅作 backlog；完成后才能对 **HTTPS** 获得与 DevTools 类似的 **path / header / body（若策略允许）** 等丰富信息。实现时须独立变更 + 规格增量 + 安全评审。

- 7.1 设计 **本地开发用根 CA** 的生成、存储轮换与泄露防护策略
- 7.2 实现 **按域名动态签发** 叶子证书、SNI 处理、证书缓存与有效期策略
- 7.3 实现 **跨平台信任引导**（用户显式安装根证书；禁止静默安装生产环境）
- 7.4 **MITM TLS** 与 **上游 TLS** 校验分离；**Certificate Pinning** 失败时的 **事件告警** 与 **回退隧道** 策略
- 7.5 规则层支持 per-host **「解密 / 仅隧道」**；与观测事件字段（path、header、可选 body hash）对齐
- 7.6 更新安全文档与合规说明（开发/本机限定、与用户数据红线）

