## Context

Studio 已区分 **Node 基座**（外置浏览器 + Core）与 **Electron 基座**（壳内加载同一 Web）。壳侧已有 preload 窄 API（如 Qt AX 覆盖层）。矢量录制与 segment / checkpoint 等业务在 Web 内已有入口；用户希望在 **任意前台应用** 下仍能通过快捷键触发，这需要 **Electron `globalShortcut`**（主进程），浏览器无法实现等价能力。

## Goals / Non-Goals

**Goals:**

- 在 Electron 中提供 **全局**快捷键（用户确认：全局，非「仅应用聚焦」）。
- 快捷键映射为 **固定动作 ID**（闭集），通过 IPC 通知渲染进程执行与 UI 按钮等价的逻辑。
- Web 提供 **快捷键配置 UI**；**仅 Electron** 可见；Node 基座下 **不展示** 配置入口。
- 注册失败（被系统占用、非法 accelerator）时 **可感知**（错误信息或状态），退出应用时 **全部注销**。

**Non-Goals:**

- 不在 Core 增加「全局快捷键」HTTP 或 SSE（快捷键纯壳侧）。
- 不支持用户自定义「任意脚本」或开放 URL 协议。
- 不保证与所有第三方全局快捷键零冲突（以 Electron / OS 行为为准，文档化局限）。

## Decisions

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 注册 API | Electron `globalShortcut` | `Menu` accelerator only | 需 **应用失焦仍生效**，与「全局」一致 |
| 动作模型 | 闭集字符串 ID | 透传键盘码由 Web 解析 | 主进程不执行业务，仅投递 ID，安全、可测 |
| 矢量录制 | **单键切换**（toggle）MVP | 开始/停止两键 | 减少默认占用键位；若产品坚持可分拆为后续任务 |
| 配置持久化 | **Renderer `localStorage` + 启动时同步主进程** | 仅主进程文件 | 与现有 Web 配置习惯一致；主进程在 `ready` 后接受一次 `invoke` 批量注册 |
| 冲突处理 | 注册失败时该键 **不生效**，保留上一成功绑定或空 | 自动 fallback | 可预测；UI 展示失败原因 |
| IPC 方向 | Main → Renderer：`webContents.send` 投递动作 | Renderer 轮询 | 低延迟、简单 |

**动作 ID（MVP，可扩展）：**

- `vector-record-toggle` — 切换矢量录制（与现有 UI 行为一致）
- `segment-start` — 打入点（segment 起）
- `segment-end` — 出点（segment 止）
- `checkpoint` — 检查点

（若代码中事件名不同，实现时以 **单一映射表** 对齐现有 replay API。）

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 系统或其它 App 占用快捷键 | UI 显示注册失败；允许用户换键 |
| macOS 保留键冲突 | 文档说明；尽量选组合键 |
| 全局触发时 Web 未就绪 | IPC 缓冲丢弃或忽略；可选在主进程队列（非 MVP） |
| 与页面内快捷键重复 | 闭集 + 文档：建议避免与 Studio 内冲突 |
| 安全：误触 | 使用组合键默认；可选「需二次确认」为后续 |

## Migration Plan

- 新能力：**无数据迁移**；首次安装无默认全局快捷键或提供文档化默认（需产品确认）。
- 回滚：移除注册与 IPC 即可，Web 配置块隐藏不影响 Node 用户。

## Open Questions

- 默认 accelerator 组合（需避免与常见 IDE/OS 冲突）—— **实现阶段**与产品定一版。
- `vector-record-toggle` 在「未选会话」等行为是否与按钮完全一致 —— 实现时与现有按钮 handler 对齐并补测试。
