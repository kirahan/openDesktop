## 1. Electron 主进程与 IPC

- [x] 1.1 在 `packages/studio-electron-shell` 主进程实现 `globalShortcut` 注册/注销封装（按动作 ID + accelerator 映射；退出时 `unregisterAll`）
- [x] 1.2 增加 IPC：`invoke` 应用绑定列表、单键更新；`webContents.send` 向主窗口投递动作 ID；注册失败时返回可机读错误
- [x] 1.3 在 `preload.cjs` 经 `contextBridge` 暴露 `getGlobalShortcutBindings` / `setGlobalShortcutBindings`（或等价）与 `onGlobalShortcutAction` 订阅

## 2. Web：类型、配置 UI、动作处理

- [x] 2.1 扩展 `packages/web/src/studioShell.ts` 中 `OdShellElectron` 类型与 `getElectronShell()` 使用方式文档化注释
- [x] 2.2 新增快捷键配置区块：**仅** `getElectronShell()?.kind === 'electron'` 时渲染；含动作说明、accelerator 输入、保存、恢复默认、错误展示
- [x] 2.3 订阅 IPC：收到动作 ID 时调用与现有按钮 **相同** 的矢量录制 toggle / segment / checkpoint 处理函数（抽共享 handler 若尚未存在）
- [x] 2.4 启动时（Electron）将 `localStorage`（或 design 选定存储）中的绑定同步到主进程并处理失败态

## 3. 测试与文档

- [x] 3.1 Web：mock `__OD_SHELL__`，单测「非 Electron 不渲染配置区块」「Electron 渲染」；动作分发逻辑单测（可 mock handler）
- [x] 3.2 更新 `docs/studio-shell.md`：全局快捷键能力、IPC 形状、仅 Electron；Node 基座无此能力
