## Context

OpenDesktop 已通过 CDP 附着 Electron 子进程、`SessionManager`、Bearer API，以及既有「矢量录制」中的 **Runtime.addBinding + 注入脚本** 路径。用户希望升级为 **rrweb** 风格的 **DOM 级会话回放**（类 Sentry Replay Player），并额外要求 **通用 `inject.bundle.js`** 可通过 **UI 按钮** 对任意当前选中的 page target 注入，而不依赖业务应用内置 SDK。

### 与既有矢量录制的关系

本变更与现有矢量录制能力 **不互斥**：二者 **与现有矢量录制双轨并存**；实现上 **可选时间轴对齐**（同一会话、同一时钟基准下关联指针事件与 rrweb 事件），便于后续在 Studio **合并为同一调试视图**（例如 rrweb 重放 DOM、上层叠加既有指针 overlay）。第一期可先分开展示与独立开关，合成与强对齐 UI **可后置**，不在本设计中单列为交付阻塞项。

## Goals / Non-Goals

**Goals:**

- 在 **单 page 主框架**（与既有矢量范围一致，第一期）内注入 **预构建的 `inject.bundle.js`**，启动 `@rrweb/record`，将事件流送达 Core 再推送至 Studio。
- Studio 使用 `**@rrweb/replayer**` 在 **单一预览容器** 内重放 DOM；**指针/点击 overlay** 与回放层 **几何对齐**（同一视口宽高基准，见下）。
- 提供 **显式 UI 操作**：「注入 rrweb 录制包」——调用 Core 将 **与构建产物一致的脚本正文** 注入指定 `sessionId` + `targetId`（复用或扩展现有 `Runtime.evaluate` / user-scripts 注入模式）。
- **版本对齐**：`inject.bundle.js` 内嵌的 record 与 Web 端 replayer **使用兼容的 rrweb 主版本**，避免事件格式漂移。

**Non-Goals（第一期）：**

- 完整对标 Sentry 的时间轴章节、AI Summary、面包屑全量产品化（可先保留最小事件列表）。
- 跨域 iframe 内完整录制、Canvas 像素内容、操作系统级全局输入。
- 将既有 `structure_snapshot`（text_digest）与 rrweb 事件 **强制合并为单一协议**（可先双轨并存，后续 reconcile）。

## Decisions

1. **注入包形态**
  - **决策**：`inject.bundle.js` 为 **单文件 IIFE**，入口调用封装函数如 `window.__odRrwebRecordStart(config)`，便于 `Runtime.evaluate` 单次执行或 `Page.addScriptToEvaluateOnNewDocument` 扩展（若后续需要）。  
  - **备选**：源码分散在 repo，由构建任务打包；**禁止**在运行时从 CDN 拉 rrweb（离线与安全）。
2. **事件出页**
  - **决策**：复用 **CDP `Runtime.addBinding`** 模式：bundle 内通过具名 binding 将 JSON（或分块）发到 Core；Core 侧与现有矢量录制 **分 binding 名或分会话表项**，避免事件类型混淆。  
  - **备选**：`fetch` 打 Core HTTP——易遇 CORS/混合内容；不作为主路径。
3. **手动注入按钮**
  - **决策**：按钮触发 **Core 已有或新增** 的 `POST`（例如 `/v1/sessions/:id/targets/:tid/rrweb/inject` 或与 `user-scripts/inject` 平行），Body 为空或 `{ "source": "bundled" }`，由 **Core 读取磁盘上构建好的 bundle 文本**（或嵌入资源）再 `Runtime.evaluate`。  
  - ** rationale**：避免把大段 base64 放在 Web localStorage；版本与 Core 发布一致。
4. **回放布局**
  - **决策**：外层容器 `position: relative`；**Replayer 根节点**占满；**指针层** `position: absolute; inset: 0; pointer-events: none`，坐标按 **录制时上报的 viewport 与容器 client 尺寸** 做比例映射（与现有 `mapReplayCoordsToOverlay` 思路一致）。  
  - **备选**：rrweb 自带鼠标插件——若采用需与 OpenDesktop 指针事件时间轴对齐，一期可 **自绘 overlay** 降低耦合。
5. **依赖与构建**
  - **决策**：在 monorepo 中新增 `**packages/rrweb-inject-bundle`**（或 `packages/core/resources` + esbuild）专门 **build 产出 `inject.bundle.js`**；Web 与 Core 在发布物中 **引用同一路径或拷贝到 `webDist`**。  
  - **备选**：把 bundle 仅塞进 `packages/web/public`——Core 注入时需共享路径，优先 **单构建输出、双消费**。
6. **隐私**
  - **决策**：record 配置 **默认开启** rrweb 文档推荐的 **文本/输入类屏蔽**；在 spec 中列为 MUST，具体 key 名随 rrweb 版本写在实现注释与 `docs/API.md`。

## Risks / Trade-offs

- **[Risk] 带宽与 CPU**：rrweb 事件量远大于指针点。  
**Mitigation**：限流、批量、可配置 `sampling`、会话级开关；第一期可仅 **实时流不持久化** 或短环形缓冲。
- **[Risk] CSP 阻止内联/ eval**：部分应用 CSP 极严。  
**Mitigation**：文档说明需 `allowScriptExecution` 与可注入环境；spike 验证目标 Electron 应用。
- **[Risk] 与既有矢量录制并行**：双管道并存增加心智负担。  
**Mitigation**：UI 分组命名（「rrweb 回放」vs「矢量事件日志」）；后续 consolidate。
- **[Risk] 版本漂移**：record/replayer 不一致导致白屏。  
**Mitigation**：单一 `rrwebVersion` 常量、CI 校验、版本端点可选暴露。

## Migration Plan

- 新能力 **默认不破坏** 现有会话；未点「注入」且未开自动策略时 **无 rrweb 负载。  
- 回滚：移除路由与按钮、停止分发 bundle；Core 兼容忽略未知 binding。

## Open Questions

- 自动注入策略：是否与「开始矢量录制」**绑定同一开关**，还是 **独立开关**（建议独立，避免误开大数据流）。  
- 持久化：rrweb 事件是否写入 `dataDir` JSONL（第一期建议 **仅内存流**，后续变更追加）。

## Testing Strategy

- **单元测试**：bundle 构建产物存在性校验（CI 中检查文件大小下限）；解析单条 rrweb 事件的最小 schema 校验（若引入）。  
- **集成测试**：Mock CDP 或 stub `Runtime.evaluate` 返回，验证「注入 API 被调用」；HTTP 测试 Bearer 401/403。  
- **Web**：Replayer 容器 + mock 事件列表 **渲染不抛错**；注入按钮 **点击触发 fetch** 到正确路径（mock）。  
- **位置**：与现有 `packages/core` `*.test.ts`、`packages/web` `*.test.ts` 并列。