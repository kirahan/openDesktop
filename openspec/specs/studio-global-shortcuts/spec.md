# studio-global-shortcuts Specification

## Purpose
TBD - created by archiving change studio-electron-global-shortcuts. Update Purpose after archive.
## Requirements
### Requirement: Electron 全局快捷键仅映射闭集动作

当 **`window.__OD_SHELL__?.kind === 'electron'`** 且壳已实现本能力时，系统 SHALL 通过 **Electron 主进程** **`globalShortcut`**（或文档化等价）注册 **全局**快捷键。每个已注册快捷键 SHALL 仅映射到 **闭集动作 ID** 之一（至少包含：**矢量录制切换**、**打入点**、**出点**、**检查点**）；系统 SHALL NOT 将快捷键映射为任意脚本执行或任意 URL 打开。

主进程 SHALL 在 **应用退出**或 **显式停止快捷键服务**时 **注销**全部已注册全局快捷键。

#### Scenario: 按下已绑定全局键时渲染进程收到动作

- **WHEN** 用户按下与某动作 ID 成功绑定的 accelerator，且应用未退出
- **THEN** 主进程 SHALL 向承载 Studio 的渲染进程投递该 **动作 ID**（或文档化等价 IPC 载荷）；业务逻辑 SHALL 在渲染进程内执行

#### Scenario: Node 基座不注册全局快捷键

- **WHEN** 用户仅使用 Node 基座 + 外置浏览器（无 Electron shell）
- **THEN** 系统 SHALL NOT 注册全局快捷键；SHALL NOT 要求浏览器实现 `globalShortcut`

### Requirement: 快捷键绑定可配置且失败可感知

在 Electron 基座下，系统 SHALL 允许用户在 **Web UI** 中为各闭集动作配置 **accelerator 字符串**（与 Electron 文档化格式一致）。当某次注册 **失败**（如被占用、格式非法）时，系统 SHALL 使该绑定 **不生效**，且 SHALL 向用户提供 **可理解的状态或错误信息**（例如设置项旁提示或 toast）。

系统 SHALL 将 **持久化配置** 存储在文档化位置（例如 **`localStorage`** 或主进程文件二选一并在 `design.md` 固化）；应用启动后 SHALL 将已保存绑定同步至主进程并尝试注册。

#### Scenario: 非法或占用时旧绑定不被静默覆盖

- **WHEN** 用户将某动作改为无效 accelerator 或已被占用的组合
- **THEN** 该动作 SHALL 保持无有效全局快捷键或保留上一次成功绑定（行为在 design 中二选一并固化）；且 SHALL NOT 静默成功

### Requirement: 快捷键配置 UI 仅 Electron 可见

**Studio** SHALL 在 **`kind === 'electron'`** 时展示 **全局快捷键配置**入口或区块（动作列表、快捷键输入、恢复默认等）。当 **`kind !== 'electron'`** 或 **`__OD_SHELL__` 不存在** 时，系统 SHALL **NOT** 展示该配置区块（**SHALL NOT** 仅 `disabled` 隐藏意图——以 **不渲染** 或等价不可见为准）。

#### Scenario: 外置浏览器中无配置入口

- **WHEN** 用户在外置浏览器中打开 Studio
- **THEN** 用户 SHALL NOT 看到全局快捷键配置按钮或面板

#### Scenario: Electron 内可见配置

- **WHEN** 用户在 Electron 壳内打开 Studio
- **THEN** 用户 SHALL 能看到与全局快捷键相关的配置能力（与实现位置无关）

### Requirement: 与矢量录制及打点业务一致

当渲染进程收到 **闭集动作 ID** 时，系统 SHALL 触发与 **既有 UI 控件** 等价的业务效果（矢量录制切换、打入点、出点、检查点）。若当前状态不满足操作前提（例如未选择会话），系统 SHALL 与对应按钮行为 **一致**（含无操作、错误或提示）。

#### Scenario: 动作与按钮行为对齐

- **WHEN** 用户通过全局快捷键触发某动作
- **THEN** 系统行为 SHALL 与用户在 Studio 内点击对应功能的结果一致（在相同应用状态下）

