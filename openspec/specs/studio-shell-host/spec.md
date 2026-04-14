# studio-shell-host Specification

## Purpose

约定 **Node 基座**（Core + 外置浏览器）与 **Electron 基座**（壳内 spawn Core + BrowserWindow）长期并存；Core 与 Web 为唯一业务真源，Electron 壳为附加包，负责就绪检测、退出清理与差异化原生能力（如可执行文件选择）。

## Requirements

### Requirement: 两种基座长期并存且共享同一 Core 与 Web 真源

系统 SHALL 支持 **Node 基座**与 **Electron 基座**两种启动形态。**`packages/core`** 提供的 HTTP API 与 **`packages/web`** 构建的 SPA SHALL 为唯一业务真源；Electron 壳 SHALL NOT 复制或分叉 Core/Web 业务源码树。Node 基座 SHALL 保持「用户或脚本启动 Core、外置浏览器访问」路径可用；Electron 基座 SHALL 通过 **子进程**启动同一套 Core 行为（与 CLI 启动等价），并以 **BrowserWindow** 加载与浏览器一致的 Web 入口。

#### Scenario: Node 基座仍可用于开发

- **WHEN** 用户未使用 Electron 安装包，仅按文档执行 **`opd core start`**（或等价）并打开浏览器
- **THEN** Core 与 Web SHALL 与变更前行为一致，且 SHALL NOT 依赖 Electron 存在

#### Scenario: Electron 基座不替换 Core 仓库职责

- **WHEN** 审查 monorepo 目录布局
- **THEN** Core 与 Web SHALL 仍位于既有 **`packages/core`** 与 **`packages/web`**（或文档化等价路径），Electron 壳 SHALL 为 **附加** 包而非替代

### Requirement: Electron 壳在展示 Web 前等待 Core 就绪

Electron **主进程** SHALL 在 spawn Core 后，于 **`loadURL`（或等价）** 打开 Studio 前，等待 Core HTTP 服务 **可访问**（例如对 **`GET /v1/version`** 或文档化健康检查成功轮询）。若超时，SHALL 向用户展示 **可理解错误**（含日志路径或重试提示），且 SHALL NOT 静默白屏。

#### Scenario: Core 未监听时不加载 SPA

- **WHEN** Core 子进程尚未在约定端口响应
- **THEN** BrowserWindow SHALL NOT 假定 SPA 已可用；SHALL 显示加载或错误状态直至就绪或失败

### Requirement: 退出 Electron 时终止 Core 子进程

当用户退出 Electron 应用（所有窗口关闭或明确退出）时，主进程 SHALL **终止**其启动的 Core 子进程（**SIGTERM** 或平台等价），并 SHALL 释放监听端口，避免僵尸进程。若子进程已退出，SHALL NOT 抛未处理异常。

#### Scenario: 正常退出无残留监听

- **WHEN** 用户从 Electron 菜单或窗口关闭应用
- **THEN** 原 Core 占用端口 SHALL 在合理时间内可被复用（无长期残留 `LISTEN`）

### Requirement: 渲染进程可探测壳类型与版本

Electron **preload** SHALL 通过 **`contextBridge`** 暴露 **只读** 对象（例如 **`window.__OD_SHELL__`**），至少包含：**`kind: 'electron'`** 与 **`version`**（壳版本或应用版本）。**Node 基座 + 外置浏览器**下该对象 SHALL **不存在**或 **`kind`** 为文档化默认值（如 **`browser`**），且 Web SHALL NOT 因缺失而崩溃。

#### Scenario: 浏览器无增强 API 时降级

- **WHEN** `window.__OD_SHELL__` 未定义或 `kind` 非 `electron`
- **THEN** Studio SHALL 使用既有 HTTP/表单路径，且 SHALL NOT 调用仅 Electron 提供的原生方法

### Requirement: Electron 差异化能力之原生可执行文件选择

在 **`kind === 'electron'`** 时，系统 SHALL 提供 **主进程** **`dialog.showOpenDialog`**（或文档化等价）供用户选择 **单个可执行文件或应用程序包**，并将 **绝对路径** 返回给渲染进程（通过 **已暴露的 Promise 式 API**）。该路径 **MAY** 直接填入注册表单，**无需**调用 Core 的「远程弹框」类 HTTP；**浏览器基座** SHALL 继续使用既有方式（例如 **`GET /v1/pick-executable-path`** 或手输，以实现为准）。

#### Scenario: Electron 下选路径不依赖 Core 弹框 HTTP

- **WHEN** 用户在 Electron 中点击「选择可执行文件」且壳已实现该 API
- **THEN** 路径 SHALL 由系统对话框返回；**SHALL NOT** 要求本次交互必须成功调用 Core 的 pick-executable HTTP

#### Scenario: 浏览器基座行为不变

- **WHEN** 用户在外置浏览器中使用 Studio
- **THEN** 可执行路径选择 SHALL 仍走文档化既有路径（含 Core 辅助接口），且 SHALL 与变更前一致

### Requirement: 差异化能力不得绕过 Core 的持久化与校验

无论基座为何，**创建/更新应用**（如 **`POST /v1/apps`**、**`PATCH`**）SHALL **仍由 Core** 执行持久化与文档化校验（含 **`uiRuntime`**、非法路径等）。Shell SHALL NOT 仅因原生对话框返回路径而跳过 Core 的 API。

#### Scenario: 注册提交仍走 Core

- **WHEN** 用户在任一基座提交应用注册表单
- **THEN** 请求 SHALL 到达 Core 的 **`/v1/apps`**（或文档化等价），且 SHALL 成功或失败与 Core 规则一致

### Requirement: 壳包目录布局不破坏现有 monorepo 结构

Electron 壳 SHALL 以 **新增 `packages/<shell-name>/`**（或文档化单一目录）形式存在；**SHALL NOT** 将 Core 或 Web 迁入壳内。**根 `package.json` workspace** MAY 增加一项以纳入构建。

#### Scenario: 核心包路径稳定

- **WHEN** 贡献者克隆仓库并仅开发 Core
- **THEN** 其工作流 SHALL 无需安装 Electron 依赖即可完成 Core 单元测试（Electron MAY 为可选 workspace）
