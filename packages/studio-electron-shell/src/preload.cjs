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
});
