"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { contextBridge, ipcRenderer } = require("electron");

const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));

console.info("[studio-electron-shell][preload] preload.cjs loaded", {
  version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
});

contextBridge.exposeInMainWorld("__OD_SHELL__", {
  kind: "electron",
  version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
  /**
   * macOS：开启全屏透明十字线覆盖层，并由主进程以 ~10Hz 轮询 `screen.getCursorScreenPoint()`，
   * 通过 `subscribeQtAxCursor` 下发屏幕像素坐标（与 Core `native-accessibility-at-point?x=&y=` 一致）。
   */
  startQtAxOverlay: () => ipcRenderer.invoke("od:qt-ax-overlay-start"),
  stopQtAxOverlay: () => ipcRenderer.invoke("od:qt-ax-overlay-stop"),
  /**
   * @param {(pos: { x: number; y: number }) => void} cb
   * @returns {() => void} 取消订阅
   */
  subscribeQtAxCursor: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, pos) => {
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") cb(pos);
    };
    ipcRenderer.on("od:qt-ax-cursor", handler);
    return () => ipcRenderer.removeListener("od:qt-ax-cursor", handler);
  },
  /**
   * 将 Core `native-accessibility-at-point` 返回的 `hitFrame` 交给主进程，在透明层上绘制与 Qt 控件对齐的描边。
   * @param {null | { x: number; y: number; width: number; height: number }} rect Electron 全局坐标；`null` 清除。
   */
  setQtAxHitHighlight: (rect) => ipcRenderer.invoke("od:qt-ax-overlay-set-highlight", rect),
  /** 读取当前机器上 Core 使用的 Bearer（与数据目录下 token.txt 一致） */
  getCoreBearerToken: () => {
    console.info("[studio-electron-shell][preload] invoke od:read-core-bearer-token");
    return ipcRenderer.invoke("od:read-core-bearer-token").then((v) => {
      console.info("[studio-electron-shell][preload] od:read-core-bearer-token result", {
        type: typeof v,
        length: typeof v === "string" ? v.length : 0,
      });
      return v;
    });
  },
  pickExecutableFile: () => ipcRenderer.invoke("od:pick-executable-file"),
  /**
   * 应用全局快捷键绑定（actionId → Electron accelerator 字符串，空字符串表示不绑定）。
   * @returns {Promise<{ ok: boolean; errors?: Array<{ actionId: string; accelerator: string; code: string }> }>}
   */
  setGlobalShortcutBindings: (bindings) => {
    console.info("[studio-electron-shell][preload][globalShortcut] invoke od:set-global-shortcuts", bindings);
    return ipcRenderer.invoke("od:set-global-shortcuts", bindings).then((r) => {
      console.info("[studio-electron-shell][preload][globalShortcut] od:set-global-shortcuts 返回", r);
      return r;
    });
  },
  /**
   * @param {(payload: { actionId: string }) => void} cb
   * @returns {() => void} 取消订阅
   */
  onGlobalShortcutAction: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, payload) => {
      console.info("[studio-electron-shell][preload][globalShortcut] 收到 od:global-shortcut", payload);
      if (payload && typeof payload.actionId === "string") cb({ actionId: payload.actionId });
    };
    ipcRenderer.on("od:global-shortcut", handler);
    return () => ipcRenderer.removeListener("od:global-shortcut", handler);
  },
});
