# studio-shell-host（变更增量）

## ADDED Requirements

### Requirement: Electron 壳可选提供全局快捷键与 IPC

当 Electron 壳已实现 **全局快捷键**能力时，**主进程** SHALL 能够使用 **`globalShortcut`**（或文档化等价）注册与注销 **全局**快捷键；并在 **preload** 中通过 **`contextBridge`** 暴露 **Promise 式** API，至少支持：

- **应用启动或配置变更后**按文档化载荷 **注册**一组快捷键与 **闭集动作 ID** 的映射；
- **注销**全部或单个映射；
- 可选：**查询**当前注册结果或失败原因（与 `studio-global-shortcuts` 能力一致）。

壳 SHALL NOT 在 **`kind !== 'electron'`** 环境下假定上述 API 存在。

#### Scenario: 浏览器无全局快捷键 API

- **WHEN** `window.__OD_SHELL__` 未定义或非 Electron
- **THEN** Web SHALL NOT 调用全局快捷键 API；壳 SHALL NOT 要求浏览器实现 `globalShortcut`

#### Scenario: 退出应用时释放快捷键

- **WHEN** 用户退出 Electron 应用或壳执行统一清理
- **THEN** 已注册的全局快捷键 SHALL 被注销，且 SHALL NOT 长期占用系统快捷键表
