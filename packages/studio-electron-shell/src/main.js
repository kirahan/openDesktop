/**
 * Studio Electron 壳 — 开发 vs 生产（与下方 `shouldUseCoreDist` / `resolveStudioLoadUrl` 一致）
 *
 * **开发（未打包，`app.isPackaged === false`）**
 * 1. **Core**：默认用 **源码** — `node --import tsx packages/core/src/cli.ts core start …`，**不是** `packages/core/dist/cli.js`。
 *    - 例外：`OPENDESKTOP_ELECTRON_USE_CORE_DIST=1` 时改为 dist/cli.js（对齐 CI / 强制构建验证）。
 * 2. **Electron 窗口中的 Web**：默认 **Vite 开发服** `http://127.0.0.1:5173/`（自动 `yarn dev:web` 或复用已启动），**不是** `packages/web/dist` 的构建产物。
 *    - 例外：`OPENDESKTOP_STUDIO_USE_CORE_UI=1` 时改为加载 Core 端口上的静态页（需已 `web build` 且 Core 带 `--web-dist`）。
 * 3. **说明**：若本机已有 `packages/web/dist/index.html`，`buildCoreStartArgs()` 仍可能给 Core 加上 `--web-dist`，便于**外置浏览器**直接打开 `http://127.0.0.1:8787/`；这与 **Electron 窗口默认走 Vite** 并行不冲突。
 *
 * **生产（已打包，`app.isPackaged === true`）**
 * - **Core**：使用 **`dist/cli.js`**（及后续包内资源布局）。
 * - **窗口**：加载 **`http://127.0.0.1:<Core 端口>/`**，由 **已打包的 Core 托管静态 Web**（`web/dist` 随产品分发），不再启动 Vite。
 *
 * @see docs/studio-shell.md
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `packages/studio-electron-shell` 根目录 */
const shellRoot = path.resolve(__dirname, "..");
/** monorepo `packages/` */
const packagesDir = path.resolve(shellRoot, "..");
/** 仓库根（`yarn dev:web` 需在根目录执行 workspace 脚本） */
const repoRoot = path.resolve(packagesDir, "..");
const coreCliJs = path.join(packagesDir, "core", "dist", "cli.js");
/** 开发态可直接 spawn，无需先 build Core（与 `packages/core` 的 `cli` 脚本一致思路） */
const coreCliTs = path.join(packagesDir, "core", "src", "cli.ts");
const defaultWebDist = path.join(packagesDir, "web", "dist");

/** 与 `packages/core/src/config.ts` 的默认数据目录一致，用于解析 token 文件路径 */
function defaultDataDir() {
  const base =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support", "OpenDesktop")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "OpenDesktop")
        : path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"), "opendesktop");
  return base;
}

/** 与 Core `loadConfig().tokenFile` 对齐（含 OPENDESKTOP_DATA_DIR / OPENDESKTOP_TOKEN_FILE） */
function resolveCoreTokenFilePath() {
  const dataDir = process.env.OPENDESKTOP_DATA_DIR?.trim() || defaultDataDir();
  const tokenFile = process.env.OPENDESKTOP_TOKEN_FILE?.trim();
  return path.resolve(tokenFile || path.join(dataDir, "token.txt"));
}

const DEFAULT_PORT = Number.parseInt(process.env.OPENDESKTOP_PORT ?? "8787", 10);
const READY_POLL_MS = 200;
const READY_TIMEOUT_MS = 60_000;
/** 开发态默认走 Vite（与 `yarn dev:web` / `vite --host 127.0.0.1` 一致，默认端口 5173） */
const DEFAULT_STUDIO_DEV_UI = "http://127.0.0.1:5173/";

/** @type {import('child_process').ChildProcess | null} */
let coreChild = null;
/** 由壳启动的 `yarn dev:web`（Vite）；若你本机已手动起 Vite 则不会 spawn，此项为 null */
let viteDevChild = null;
/** @type {number} */
let corePort = Number.isFinite(DEFAULT_PORT) ? DEFAULT_PORT : 8787;
let quitAfterCleanup = false;

/** 供 Core `core start --web-dist` 使用；与 Electron 窗口在开发态默认加载 Vite 无关（见文件头说明）。 */
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

/**
 * 是否由 Core 本机端口直接提供页面（与 `waitForCoreHttpReady` 覆盖的 API 同源入口）。
 * 非此情况（如 Vite）需额外等待前端开发服务器就绪。
 */
function isStudioUrlServedByCore(loadUrl) {
  try {
    const u = new URL(loadUrl);
    return u.hostname === "127.0.0.1" && u.port === String(corePort);
  } catch {
    return false;
  }
}

/**
 * 解析 Electron 窗口加载的 Studio 前端 URL。
 * - 未打包默认：**Vite 开发服**（`DEFAULT_STUDIO_DEV_UI`），`/v1` 由 Vite 代理到 Core。
 * - `OPENDESKTOP_STUDIO_USE_CORE_UI=1`：改为加载 Core 托管的静态页（需已 `web build` 且通常带 `--web-dist`）。
 * - `OPENDESKTOP_STUDIO_URL`：完整覆盖（用于自定义 Vite 端口等）。
 */
function resolveStudioLoadUrl() {
  const forced = process.env.OPENDESKTOP_STUDIO_URL?.trim();
  if (forced) {
    const u = forced.endsWith("/") ? forced : `${forced}/`;
    console.info("[studio-electron-shell][diag] 使用 OPENDESKTOP_STUDIO_URL:", u);
    return u;
  }
  if (app.isPackaged) {
    const u = `http://127.0.0.1:${corePort}/`;
    console.info("[studio-electron-shell][diag] 已打包，加载 Core 根路径:", u);
    return u;
  }
  if (process.env.OPENDESKTOP_STUDIO_USE_CORE_UI === "1") {
    const u = `http://127.0.0.1:${corePort}/`;
    console.info("[studio-electron-shell][diag] OPENDESKTOP_STUDIO_USE_CORE_UI=1，加载 Core 托管 Web:", u);
    return u;
  }
  console.info("[studio-electron-shell][diag] 开发默认加载 Vite:", DEFAULT_STUDIO_DEV_UI);
  return DEFAULT_STUDIO_DEV_UI;
}

async function isHttpOk(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 是否在默认开发流下由壳自动执行 `yarn dev:web`（未手动指定其它 Studio URL 等）。
 * `OPENDESKTOP_ELECTRON_SKIP_VITE_SPAWN=1`：不 spawn，仅轮询（需自行先起 Vite）。
 */
function shouldAutoSpawnViteDev(loadUrl) {
  if (app.isPackaged) return false;
  if (process.env.OPENDESKTOP_STUDIO_USE_CORE_UI === "1") return false;
  if (process.env.OPENDESKTOP_STUDIO_URL?.trim()) return false;
  if (process.env.OPENDESKTOP_ELECTRON_SKIP_VITE_SPAWN === "1") return false;
  if (isStudioUrlServedByCore(loadUrl)) return false;
  return true;
}

/** 若需要 Vite 且端口空闲，则在仓库根 spawn `yarn dev:web` */
async function ensureViteDevServerRunning(loadUrl) {
  if (isStudioUrlServedByCore(loadUrl)) return;
  if (await isHttpOk(loadUrl)) {
    console.info("[studio-electron-shell][vite] 开发服务器已在运行:", loadUrl);
    return;
  }
  if (!shouldAutoSpawnViteDev(loadUrl)) {
    console.info("[studio-electron-shell][vite] 未自动启动（见 OPENDESKTOP_STUDIO_URL / SKIP 等），等待外部就绪…");
    return;
  }
  console.info("[studio-electron-shell][vite] 正在启动: yarn dev:web（cwd=%s）", repoRoot);
  const yarnCmd = process.platform === "win32" ? "yarn.cmd" : "yarn";
  viteDevChild = spawn(yarnCmd, ["dev:web"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
    windowsHide: false,
  });
  viteDevChild.on("exit", (code, signal) => {
    viteDevChild = null;
    if (code !== 0 && code !== null) {
      console.error(`[studio-electron-shell][vite] 子进程退出 code=${code} signal=${signal ?? ""}`);
    }
  });
  viteDevChild.on("error", (err) => {
    console.error("[studio-electron-shell][vite] spawn error:", err);
  });
}

/** 等待 Vite 等第三方开发服务器可响应（GET 根路径） */
async function waitForStudioDevServerReady(loadUrl) {
  if (isStudioUrlServedByCore(loadUrl)) return;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(loadUrl);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(
    `Studio 前端未在 ${READY_TIMEOUT_MS}ms 内就绪: ${loadUrl}\n` +
      `若未使用壳自动启动，请先执行 yarn dev:web；自定义端口请设置 OPENDESKTOP_STUDIO_URL。`,
  );
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

async function killViteDevChild() {
  if (!viteDevChild?.pid) return;
  try {
    viteDevChild.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 5000);
    viteDevChild?.once("exit", () => {
      clearTimeout(t);
      resolve(undefined);
    });
  });
  viteDevChild = null;
}

function logStartupDiagnostics() {
  const tokenPath = resolveCoreTokenFilePath();
  console.info("[studio-electron-shell][diag] token 文件路径（与 Core loadConfig 一致）:", tokenPath);
  console.info(
    "[studio-electron-shell][diag] 开发: Core 默认 tsx 源码 | 窗口默认 Vite。覆盖: USE_CORE_DIST / STUDIO_USE_CORE_UI / SKIP_VITE_SPAWN（见 docs/studio-shell.md）",
  );
}

function registerIpc() {
  ipcMain.handle("od:read-core-bearer-token", async () => {
    const p = resolveCoreTokenFilePath();
    const exists = existsSync(p);
    console.info("[studio-electron-shell][token] IPC od:read-core-bearer-token", {
      path: p,
      exists,
      OPENDESKTOP_DATA_DIR: process.env.OPENDESKTOP_DATA_DIR ?? "(unset)",
      OPENDESKTOP_TOKEN_FILE: process.env.OPENDESKTOP_TOKEN_FILE ?? "(unset)",
    });
    try {
      const raw = readFileSync(p, "utf8");
      const t = raw.trim();
      console.info("[studio-electron-shell][token] read ok", {
        length: t.length,
        preview: t ? `${t.slice(0, 4)}…${t.slice(-2)}` : "(empty)",
      });
      return t || null;
    } catch (e) {
      console.info("[studio-electron-shell][token] read failed", {
        path: p,
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  });

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
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await ensureCoreRunning();
    const loadUrl = resolveStudioLoadUrl();
    await ensureViteDevServerRunning(loadUrl);
    await waitForStudioDevServerReady(loadUrl);
    console.info("[studio-electron-shell][diag] loadURL →", loadUrl);
    await win.loadURL(loadUrl);
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
    logStartupDiagnostics();
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
    const hasCore = !!coreChild?.pid;
    const hasVite = !!viteDevChild?.pid;
    if (!hasCore && !hasVite) return;
    e.preventDefault();
    quitAfterCleanup = true;
    void Promise.all([killCoreChild(), killViteDevChild()]).finally(() => {
      app.quit();
    });
  });
}
