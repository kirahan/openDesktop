import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextBridge, ipcRenderer } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8")) ;

contextBridge.exposeInMainWorld("__OD_SHELL__", {
  kind: "electron",
  version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
  pickExecutableFile: () => ipcRenderer.invoke("od:pick-executable-file"),
});
