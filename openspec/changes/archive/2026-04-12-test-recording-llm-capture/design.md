## Context

已有能力提供多源信号：**矢量录制**（`pointermove` / `pointerdown` / `click` 含 `target` 摘要、`structure_snapshot` 文本摘要）、**DOM 拾取**（坐标 → `DOM.describeNode` 等节点摘要）、会话与 target 元数据。这些信号**时间粒度与语义不完全一致**，若不经组装直接喂给 LLM，模型需自行对齐事件与页面状态，成本高且易错。

本设计只解决：**把一次「测试录制会话」冻结为单一、版本化的 JSON 制品**，字段足够支撑下游 LLM 生成「可定位、可断言、可复述」的用例草稿；**不在 Core 内调用 LLM、不生成最终用例**。

## Goals / Non-Goals

**Goals**

- 定义 **`TestRecordingArtifact`（名称可最终实现时微调）** 的 `schemaVersion`、会话级字段、**`steps[]`** 结构及每步**机器采集**与**人工注释**字段。
- 明确每步应尽可能包含：**时间顺序、动作类型推断或显式类型、视口坐标、点击目标摘要（与现有矢量 `target` 对齐）、可选拾取增强（若本步触发 resolve）、可选页面文本或结构锚点（截断）**。
- 约定体积与隐私上限（字符串长度、快照条数、是否默认包含 `structure_snapshot` 全文等）。
- **落盘**：在 `dataDir` 下 **`app-json/<appId>/`** 树写入 JSON（见下节），作为后续 LLM 与工具链的**稳定输入**；同根目录可扩展其它类型 JSON，**一应用一子文件夹**不变。

**Non-Goals（本变更不实现或不要求第一期实现）**

- 在 Core 或 Web 内嵌 **LLM 推理**、提示词模板、流式输出。
- **自动生成** Recipe JSON、Playwright 或 Agent 动作并执行。
- 对「期望现象」做自动判定或测试通过与否。
- 跨 iframe 全量无障碍树（与矢量录制第一期边界一致时可沿用「主 frame + 显式说明」）。

## Decisions

### 1. 制品顶层结构

建议顶层包含（名称以实现为准，语义须一致）：

| 字段 | 说明 |
|------|------|
| `schemaVersion` | 整数，从 1 起 |
| `kind` | 固定值，如 `opendesktop.test_recording` |
| `appId` | 所属应用 id（与 `apps.json` 中一致），**落盘路径分区必需** |
| `recordedAt` / `session` | ISO 时间、OpenDesktop `sessionId`、`targetId` |
| `pageContext` | 可选：`viewportWidth`、`viewportHeight`、若可得的 `pageUrl`、`documentTitle`（来自 CDP 或注入读取） |
| `steps` | **有序**数组，一步可对应一次关键交互或用户标记的分段 |
| `notes` | 可选：整段录制的总述（自然语言），供 LLM |

### 2. 单步 `step`：机器可证 + 人可读

每步建议区分两类字段（实现时可合并为单对象，但语义分离）：

**A. `capture`（机器采集，尽量客观）**

- `ts`：毫秒时间戳（与矢量事件一致或取该步代表时刻）。
- `action`：枚举，首期至少 `click`；预留 `type`（键盘输入）、`navigate`（若后续可从 CDP 推断）等。
- `pointer`：视口坐标 `x`、`y`（与矢量一致）。
- `vectorTarget`：与现有 `click.target` 同构的可选对象（`tagName`、`id`、`className`、`data`、`selector`、`role`），**禁止丢字段名**；若某步无点击则无此块。
- `domPick`：可选；若本步在流程中执行了 `dom-pick/resolve`，则嵌入**该次**返回的节点摘要（结构在实现时与现有 HTTP 响应对齐并在此 spec 中引用或内嵌最小子集）。
- `structureAnchor`：可选；该步前后最近一次 `structure_snapshot` 的**截断文本**或哈希指针，避免每步重复全文。
- `rawEventIds` 或 `sourceLineRefs`：可选；指向原始 NDJSON 行号或事件 id，便于调试，**可不喂 LLM**。

**B. `human`（人工补充，供 LLM，不参与执行）**

- `actionDescription`：用户描述「我做了什么」（自然语言）。
- `expectedDescription`：用户描述「我期望看到什么」（自然语言）。
- 两者均可选；允许仅填一步、仅填整段 `notes`。

### 3. 与矢量时间线的对齐策略

- **默认**：在录制停止时，由 Core 或 Web 将 SSE 中事件**归并为 `steps`**：启发式为「每个 `click` 一步」，其间的 `pointermove` 可折叠为摘要或省略，仅保留点击前最后坐标（design 可选参数）。
- **增强**：允许用户在 UI 上**插入分段边界**（例如在两次点击之间标为「同一步」），写入 `step` 的 `mergeGroupId` 等字段（可选，第一期可省略）。

### 4. DOM 拾取与矢量并存

- **不强制**每步都调用 `dom-pick`（有额外 CDP 开销）。策略选项：**仅用户点击「拾取此步」时拉取**、或 **click 后自动 debounce 一次 resolve**（可在 tasks 中分期）。
- 制品中若存在 `domPick`，应标明 **与同一 `ts` 或 `click` 的对应关系**，避免 LLM 误配。

### 5. 落盘目录布局（必须）

**目标**：在数据目录下提供**唯一、可文档化**的树，专门存放「应用使用过程中产生的各类 JSON 记录」（首期以 **测试录制制品** 为主，后续其它类型 JSON **共用同一根、同一按应用分区**，避免散落多处）。

**决策**：

1. **根目录**（默认）：`<dataDir>/app-json/`  
   - **覆盖**：通过环境变量 **`OPENDESKTOP_APP_JSON_DIR`** 指向**根**（可选）；若设置，则不再默认拼在 `dataDir` 下（实现 MUST 在 `config` 中集中解析）。  
   - 启动或首次写入前 **MUST** `mkdir`（`recursive: true`）。

2. **按应用子目录**：`<根>/ <appId> /`  
   - `appId` MUST 与 Profile 或会话关联的应用 id 一致（与现有 `apps.json` 条目对应），**禁止**使用未净化的任意字符串作路径段（实现 MUST 校验或白名单化 slug，避免路径穿越）。

3. **单文件命名**（测试录制制品示例）：  
   - `test-recording-<recordingId>.json`，其中 `recordingId` 为单次录制的稳定 id（UUID 或时间戳+随机后缀）；**同一 `appId` 目录下** MAY 存在多个此类文件。  
   - 未来其它 JSON（如索引、元数据清单）MAY 并列于同一 `appId` 目录，**文件名前缀**区分类型（例如 `meta-*.json`），具体在后续小变更中追加，**不改动**根目录与「一应用一文件夹」原则。

4. **写入语义**：与配方等持久化一致，**MUST** 使用临时文件 + **原子 rename**，避免半截 JSON。

5. **与 API 关系**：HTTP 下载或列表 **SHOULD** 以磁盘为真源（或明确缓存一致性）；「仅剪贴板不落盘」可作为开发期选项，**正式能力以落盘为准**。

6. **非目标**：不在此目录存放 Recipe 文件（仍走 `recipesDir`）；不在此目录存放 rrweb 原始事件二进制大块（若未来需要，单独子路径或扩展名在后续 design 中定义）。

### 6. 隐私与合规

- 制品可能含页面文本、URL、DOM 路径；默认 **与现有录制相同假设**（本地调试、Bearer 保护）；文档中 MUST 声明**不得默认上传公网**。
- 提供**最大文本长度**与 **structure 截断**常量，与 `structure_snapshot` 现有策略对齐或略放宽用于 LLM。

## Risks / Trade-offs

- **字段过多** → token 浪费；缓解：导出 API 支持 `detailLevel: minimal | full`（后续）。
- **启发式分步**与真实用户意图不一致 → 缓解：人工 `notes` + 可选手动分段。
- **selector 不稳定** → 制品中同时保留 `vectorTarget` 与 `domPick`，让 LLM 多信号融合。

## Open Questions

- `pageUrl` / `title` 在 Electron 多导航下的采样时刻（录制开始、结束、每步）是否写入多值？建议首期仅录制**结束时刻**或**每步点击时**一次。
- 是否与 rrweb 事件并存于同一制品？建议 **首期不混合**：矢量制品与 rrweb 分文件，通过 `sessionId` + `recordingId` 关联；若 rrweb 也需落盘，建议仍放在 **同一 `appId` 子目录** 下、不同文件名前缀。

## Testing Strategy

- **Schema 校验单元测试**：合法 / 非法制品样例（`packages/core` 或共享 `schema` 包）。
- **归并逻辑测试**：给定固定 NDJSON 输入，期望输出固定 `steps[]`（纯函数）。
- **HTTP**：若新增导出端点，则 401、空录制与鉴权与现有风格一致。

## 附录：示例制品（`schemaVersion` 1，说明用）

下列为**示意**；字段名以实现校验器为准。

```json
{
  "schemaVersion": 1,
  "kind": "opendesktop.test_recording",
  "recordedAt": "2026-04-12T08:00:00.000Z",
  "appId": "demo-app",
  "sessionId": "sess_xxx",
  "targetId": "target_page_1",
  "pageContext": {
    "viewportWidth": 1280,
    "viewportHeight": 720,
    "pageUrl": "https://example.com/app",
    "documentTitle": "示例应用"
  },
  "notes": "登录流程探测",
  "steps": [
    {
      "ts": 1775983640505,
      "action": "click",
      "capture": {
        "x": 570.6,
        "y": 349,
        "vectorTarget": {
          "tagName": "button",
          "id": "login-btn",
          "selector": "main > form > button#login-btn"
        },
        "structureAnchor": "登录\n用户名 …"
      },
      "human": {
        "actionDescription": "点击登录按钮",
        "expectedDescription": "进入已登录后的首页或出现错误提示"
      }
    }
  ]
}
```

`domPick` 若存在，建议与 `capture` 并列或置于 `capture.domPick`，与现有 `dom-pick/resolve` 响应字段对齐（实现时二选一并写死映射表）。

**落盘路径示例**（`dataDir` 为 OpenDesktop 数据目录、`recordingId` 由实现生成）：

`{dataDir}/app-json/demo-app/test-recording-{recordingId}.json`
