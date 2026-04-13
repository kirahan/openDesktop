## Context

- 会话在 `running` 时，`SessionManager` 已记录子进程 `**pid**`（见 `SessionRecord`）。
- 现有 `list-window` / CDP 路径仅覆盖 **Chromium** 调试目标；Qt 应用（如 OBS）需 **Accessibility** 树。
- macOS 提供 `**AXUIElement`**（`ApplicationServices`）：可对 **应用级** `AXUIElementCreateApplication(pid)` 递归读取子元素及 `AXRole`、`AXTitle`、`AXValue` 等属性。

## Goals / Non-Goals

**Goals:**

- 在 **macOS** 上，针对 **会话关联 PID**，生成 **可 JSON 序列化** 的无障碍树（带深度/数量上限，防止卡死）。
- 通过 **Core HTTP** 暴露，供 Web / CLI / 外部 Agent 拉取。
- **Studio Web** 必含一键拉取与结果展示（见 tasks），与 `**capabilities.nativeAccessibilityTree`** 联动。
- 错误语义清晰：**非 darwin**、**会话无 pid**、**未授权辅助功能**、**采集超时** 等可区分。

**Non-Goals:**

- Windows / Linux AT-SPI（后续变更）。
- 自动 **执行** 无障碍动作（点击/设值）——可与未来 `native-a11y-action` 变更衔接，本变更只 **读树**。
- 保证 Qt 应用 **完整** 控件树：若应用未向系统暴露 AX 节点，树可能浅或空（仅文档化）。

## Decisions


| 决策     | 选择                                                                      | 备选                | 理由                                              |
| ------ | ----------------------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| 采集实现位置 | 优先 **Node 子进程** 调用 **Swift 小 CLI**（或单文件 `swift` 脚本）输出 JSON              | 纯 `osascript`/JXA | JXA 对 AX 递归与性能较弱；Swift 直接调 `AXUIElement`* 更稳、易测 |
| 进程定位   | `AXUIElementCreateApplication(sessionPid)`                              | 按窗口标题猜            | PID 已由会话持有，确定性高                                 |
| 输出形态   | 精简 JSON 节点：`{ role, title?, value?, children? }` + 可选 `axFrame`         | 复制全部 AX 属性        | 控制体积；后续可按需加白名单属性                                |
| 上限     | `maxDepth`（默认如 12）、`maxNodes`（默认如 5000）可查询参数                            | 无限制               | 防止恶意或超大树拖垮 Core                                 |
| 权限失败   | 检测 `kAXErrorAPIDisabled` 等，返回 **403** + 固定码（如 `ACCESSIBILITY_DISABLED`） | 静默空树              | 用户需知如何到系统设置授权                                   |


## Risks / Trade-offs


| 风险                | 缓解                                        |
| ----------------- | ----------------------------------------- |
| 用户未给「辅助功能」权限      | 明确错误码与文档；可选在 README 链到系统设置                |
| Qt 版本/主题导致 AX 树过浅 | Non-Goals 已说明；可在 UI 提示「若为空请检查应用是否启用无障碍」   |
| 大树性能              | `maxNodes` 截断并在 JSON 中带 `truncated: true` |
| 安全：任意会话拉树         | 已有 Bearer；仅本机会话；不跨用户                      |


## Migration Plan

- 新接口 additive；无数据迁移。
- 若后续把 Swift 工具单独分发，可在 `doctor` 中增加 **探测辅助二进制是否存在**。

## Open Questions

- Swift CLI 是否随 `@opendesktop/core` 一同打包进 `files`，或由源码构建时 `swift build`（CI 需 Xcode）——实现阶段在 tasks 中收敛。
- 是否在 `GET /v1/version` 的 `capabilities` 中增加 `nativeAccessibilityTree: true|false` —— 建议 **是**（仅 darwin 为 true）。