"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__OD_OVERLAY__", {
  /**
   * @param {(pos: { x: number; y: number }) => void} cb 与主屏覆盖窗口同坐标系下的局部像素（相对窗口左上角）
   */
  subscribePosition: (cb) => {
    const handler = (_event, pos) => {
      if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
      const h = pos.highlight;
      let highlight = null;
      if (
        h &&
        typeof h === "object" &&
        typeof h.x === "number" &&
        typeof h.y === "number" &&
        typeof h.width === "number" &&
        typeof h.height === "number"
      ) {
        highlight = { x: h.x, y: h.y, width: h.width, height: h.height };
      }
      cb({ x: pos.x, y: pos.y, highlight });
    };
    ipcRenderer.on("od-overlay-draw", handler);
    return () => ipcRenderer.removeListener("od-overlay-draw", handler);
  },
});
