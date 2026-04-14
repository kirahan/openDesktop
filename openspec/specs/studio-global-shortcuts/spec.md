# studio-global-shortcuts Specification

## Purpose

Electron 壳下全局快捷键：闭集动作 ID、主进程注册与 **Core 控制面** 调用路径；Web 仅负责 accelerator 配置与可选会话上下文同步。

## Requirements

### Requirement: Electron 全局快捷键仅映射闭集动作

当 **`window.__OD_SHELL__?.kind === 'electron'`** 且壳已实现本能力时，系统 SHALL 通过 **Electron 主进程** **`globalShortcut`**（或文档化等价）注册 **全局**快捷键。每个已注册快捷键 SHALL 仅映射到 **闭集动作 ID** 之一（至少包含：**矢量录制切换**、**打入点**、**出点**、**检查点**）；系统 SHALL NOT 将快捷键映射为任意脚本执行或任意 URL 打开。

主进程 SHALL 在 **应用退出**或 **显式停止快捷键服务**时 **注销**全部已注册全局快捷键。

#### Scenario: 按下已绑定全局键时主进程调用 Core 控制面

- **WHEN** 用户按下与某动作 ID 成功绑定的 accelerator，且应用未退出
- **THEN** Electron 主进程 SHALL 使用该闭集 **动作 ID**，通过 **Bearer 鉴权** 调用 Core **文档化控制面 API** 以触发等价业务效果；业务逻辑 SHALL 在 **Core** 内执行

#### Scenario: Node 基座不注册全局快捷键

- **WHEN** 用户仅使用 Node 基座 + 外置浏览器（无 Electron shell）
- **THEN** 系统 SHALL NOT 注册全局快捷键；SHALL NOT 要求浏览器实现 `globalShortcut`

### Requirement: Electron 主进程为全局快捷键业务的主路径

当 **`window.__OD_SHELL__?.kind === 'electron'`** 且用户按下已注册的闭集快捷键时，系统 SHALL 由 **Electron 主进程** 完成向 **Core HTTP 控制面** 的调用以执行业务；**SHALL NOT** 将「Studio Web 渲染进程已挂载并已订阅 IPC」作为完成该业务的必要条件。

Studio Web MAY 接收 **仅用于 UI 同步** 的 IPC 或状态更新，SHALL NOT 作为唯一执行业务的路径。

#### Scenario: Web 未打开时快捷键仍可执行业务

- **WHEN** Electron 应用已启动、主进程已成功注册全局快捷键且 Bearer 可用，但用户未打开或未加载 Studio Web
- **THEN** 用户按下快捷键时 Core 控制面 SHALL 仍能被主进程调用并成功执行业务（在会话与 target 前提满足时）

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

当用户通过 **全局快捷键** 触发闭集动作时，系统 SHALL 产生与 **既有 Studio UI 控件** 在 **相同会话与 target 上下文** 下等价的业务效果（矢量录制切换、打入点、出点、检查点）。规范路径为 **Electron 主进程 → Core 控制面**；若实现保留向渲染进程的兼容通知，SHALL NOT 导致与按钮路径 **重复** 的业务副作用（例如同一次按键两次 `start`）。

#### Scenario: 动作与按钮行为对齐

- **WHEN** 用户通过全局快捷键触发某动作，且应用状态与在 Studio 内点击对应该动作的控件时等价
- **THEN** 系统行为 SHALL 与点击控件的结果一致（含无操作、错误或可机读失败）

### Requirement: 多 target 并行时打点类快捷键的目标选择策略

当同一会话下存在 **多于一个** `targetId` 处于矢量录制**活跃**状态，或 Studio 存在多个与不同 `targetId` 绑定的观测上下文时，用户通过 **全局快捷键** 触发 **打入点**、**出点**、**检查点** 类动作时，系统 SHALL 采用 **文档化且唯一默认** 的目标选择策略（见对应变更 design **D5**）。系统 SHALL NOT 在未定义策略时随机选择 target。

系统 SHALL 在 UI 或文档中说明当前策略（例如：**以当前选中的观测 tab 所对应的 `targetId` 为准**）。若当前上下文不满足打点前置条件，系统 SHALL 与对应按钮行为一致（无操作、提示或错误）。

#### Scenario: 策略可查询

- **WHEN** 用户查看全局快捷键或打点相关帮助
- **THEN** 用户 SHALL 能获知「多 target 并行时打点作用于哪一个 target」的规则

#### Scenario: 无有效目标时不打点

- **WHEN** 当前选中 tab 非矢量录制流、或未绑定有效 `targetId`、或录制未运行（与按钮前置一致）
- **THEN** 快捷键触发 SHALL NOT 对任意 `targetId` 写入入点/出点/检查点

#### Scenario: 单 target 时与既有行为一致

- **WHEN** 同会话仅存在一个满足条件的矢量录制 target
- **THEN** 快捷键打点 SHALL 作用于该 `targetId`，与变更前用户预期一致
