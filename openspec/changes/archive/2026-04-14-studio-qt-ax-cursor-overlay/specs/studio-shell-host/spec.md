# studio-shell-host（变更增量）

## ADDED Requirements

### Requirement: Electron 壳可选提供 Qt AX 光标覆盖窗口与 IPC

当 Electron 壳已实现 **Qt AX 光标捕获**相关能力时，**主进程** SHALL 能够创建并销毁 **透明**、用于全屏或接近全屏绘制的 **BrowserWindow**（或文档化等价），并在 **preload** 中通过 **`contextBridge`** 暴露 **Promise 式** API，至少支持：

- **启动**覆盖层（进入捕获模式）；
- **停止**覆盖层并释放资源（退出捕获模式）；
- 向渲染进程 **上报**当前用于绘制的 **屏幕坐标**（或与 Web 约定由 Web 轮询读取，二者择一并在 `design.md` 固化）。

壳 SHALL NOT 在 **`kind !== 'electron'`** 环境下假定上述 API 存在；**Node 基座 + 外置浏览器** SHALL 保持与变更前一致。

#### Scenario: 浏览器无覆盖 API 时壳不报错

- **WHEN** `window.__OD_SHELL__` 未定义或非 Electron
- **THEN** Web SHALL 不调用覆盖 API；壳 SHALL NOT 要求浏览器实现透明窗口

#### Scenario: 退出应用时释放覆盖窗口

- **WHEN** 用户退出 Electron 应用或壳执行统一清理
- **THEN** 覆盖窗口 SHALL 被关闭或销毁，且 SHALL NOT 长期残留为透明顶层窗口
