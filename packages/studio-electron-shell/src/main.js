import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `packages/studio-electron-shell` 根目录 */
const shellRoot = path.resolve(__dirname, "..");
/** monorepo `packages/` */
const packagesDir = path.resolve(shellRoot, "..");
const coreCliJs = path.join(packagesDir, "core", "dist", "cli.js");
/** 开发态可直接 spawn，无需先 build Core（与 `packages/core` 的 `cli` 脚本一致思路） */
const coreCliTs = path.join(packagesDir, "core", "src", "cli.ts");
const defaultWebDist = path.join(packagesDir, "web", "dist");

const DEFAULT_PORT = Number.parseInt(process.env.OPENDESKTOP_PORT ?? "8787", 10);
const READY_POLL_MS = 200;
const READY_TIMEOUT_MS = 60_000;

/** @type {import('child_process').ChildProcess | null} */
let coreChild = null;
/** @type {number} */
let corePort = Number.isFinite(DEFAULT_PORT) ? DEFAULT_PORT : 8787;
let quitAfterCleanup = false;

function resolveWebDist() {
  const fromEnv = process.env.OPENDESKTOP_WEB_DIST?.trim();
  if (fromEnv && existsSync(path.join(fromEnv, "index.html"))) return path.resolve(fromEnv);
  if (existsSync(path.join(defaultWebDist, "index.html"))) return defaultWebDist;
  return null;
}

/**
 * 未打包：默认用 `node --import tsx src/cli.ts`（免先 build Core）。
 * 设置 `OPENDESKTOP_ELECTRON_USE_CORE_DIST=1` 时强制 `dist/cli.js`（接近生产/已构建验证）。
 * 已打包（`app.isPackaged`）：仅使用 dist（由 electron-builder 等资源布局提供路径；当前仍以 monorepo 路径解析）。
 */
function shouldUseCoreDist() {
  if (app.isPackaged) return true;
  return process.env.OPENDESKTOP_ELECTRON_USE_CORE_DIST === "1";
}

function buildCoreStartArgs() {
  const args = ["core", "start", "--port", String(corePort), "--host", "127.0.0.1"];
  const webDist = resolveWebDist();
  if (webDist) args.push("--web-dist", webDist);
  return args;
}

async function isCoreAlreadyUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${corePort}/v1/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCoreHttpReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${corePort}/v1/version`;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`Core 未在 ${READY_TIMEOUT_MS}ms 内就绪: ${url} — ${lastErr}`);
}

function spawnCoreOrThrow() {
  const startArgs = buildCoreStartArgs();
  const useDist = shouldUseCoreDist();
  /** @type {string[]} */
  let execArgv;
  if (useDist) {
    if (!existsSync(coreCliJs)) {
      throw new Error(
        `未找到 Core 构建产物：${coreCliJs}\n请先执行：yarn workspace @opendesktop/core run build`,
      );
    }
    execArgv = [coreCliJs, ...startArgs];
    console.log("[studio-electron-shell] Core 启动方式: dist/cli.js");
  } else {
    if (!existsSync(coreCliTs)) {
      throw new Error(
        `未找到 Core 源码入口：${coreCliTs}\n或设置 OPENDESKTOP_ELECTRON_USE_CORE_DIST=1 使用已构建的 dist/cli.js`,
      );
    }
    execArgv = ["--import", "tsx", coreCliTs, ...startArgs];
    console.log("[studio-electron-shell] Core 启动方式: tsx src/cli.ts（开发，无需先 build Core）");
  }
  // 主进程跑在 Electron 里时 process.execPath 是 Electron 而非 node；直接 spawn 会把
  // `--import tsx …` 当成 Electron CLI，报「Unable to find Electron app at …/tsx」。
  // ELECTRON_RUN_AS_NODE=1 时同一二进制按 Node 解释后续参数（与官方文档一致）。
  const childEnv = {
    ...process.env,
    OPENDESKTOP_PORT: String(corePort),
  };
  if (process.versions.electron) {
    childEnv.ELECTRON_RUN_AS_NODE = "1";
  }
  coreChild = spawn(process.execPath, execArgv, {
    env: childEnv,
    stdio: "inherit",
    windowsHide: false,
  });
  coreChild.on("exit", (code, signal) => {
    coreChild = null;
    if (code !== 0 && code !== null) {
      console.error(`Core 子进程退出 code=${code} signal=${signal ?? ""}`);
    }
  });
  coreChild.on("error", (err) => {
    console.error("Core 子进程 error:", err);
  });
}

async function ensureCoreRunning() {
  if (await isCoreAlreadyUp()) return;
  spawnCoreOrThrow();
  await waitForCoreHttpReady();
}

async function killCoreChild() {
  if (!coreChild || !coreChild.pid) return;
  try {
    coreChild.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 5000);
    coreChild?.once("exit", () => {
      clearTimeout(t);
      resolve(undefined);
    });
  });
  coreChild = null;
}

function registerIpc() {
  ipcMain.handle("od:pick-executable-file", async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const props =
      process.platform === "darwin"
        ? {
            title: "选择可执行文件或应用程序",
            properties: ["openFile", "openDirectory"],
            message: "可选择 .app、Unix 可执行文件或文件夹",
          }
        : process.platform === "win32"
          ? {
              title: "选择可执行文件",
              properties: ["openFile"],
              filters: [
                { name: "Executable", extensions: ["exe"] },
                { name: "Shortcut", extensions: ["lnk"] },
              ],
            }
          : {
              title: "选择可执行文件",
              properties: ["openFile"],
            };

    const { canceled, filePaths } = await dialog.showOpenDialog(focused ?? undefined, props);
    if (canceled || !filePaths?.length) return null;
    return filePaths[0];
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await ensureCoreRunning();
    await win.loadURL(`http://127.0.0.1:${corePort}/`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await dialog.showErrorBox("OpenDesktop Studio", `无法启动 Core 或加载界面：\n${msg}`);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    void createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (e) => {
    if (quitAfterCleanup) return;
    if (!coreChild?.pid) return;
    e.preventDefault();
    quitAfterCleanup = true;
    void killCoreChild().finally(() => {
      app.quit();
    });
  });
}
