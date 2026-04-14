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
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from "electron";

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

/** Studio 主 BrowserWindow（用于向渲染进程转发屏幕指针坐标） */
/** @type {BrowserWindow | null} */
let studioShellMainWindow = null;
/** 全屏透明十字线覆盖层 */
/** @type {BrowserWindow | null} */
let qtAxOverlayWindow = null;
/** @type {ReturnType<typeof setInterval> | null} */
let qtAxCursorInterval = null;
/** Core `hitFrame`（Electron 全局坐标），由渲染进程在 at-point 轮询成功后回传 */
/** @type {{ x: number; y: number; width: number; height: number } | null} */
let qtAxLastHitFrameGlobal = null;

/** @type {Record<string, string>} actionId → accelerator（空字符串表示未绑定） */
let globalShortcutBindingsSnapshot = {};

/**
 * 由 Studio Web `setStudioSessionContext` IPC 同步。
 * `sessionId`：当前会话；`targetId` 可选，矢量观测 Tab 选中时用于 segment/checkpoint 单 target。
 */
let studioShortcutContext = { sessionId: null, targetId: null };

/**
 * 将用户输入整理为 Electron 可解析的 accelerator（全角符号、修饰键别名、多余空格等）。
 * @param {string} raw
 * @returns {string} 规范化后的字符串；无法解析时返回 ""
 * @see https://www.electronjs.org/docs/latest/api/accelerator
 */
function normalizeElectronAccelerator(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/\uFF0B/g, "+").replace(/\uFE62/g, "+");
  const segments = s
    .split("+")
    .map((p) => p.normalize("NFKC").trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) {
    return normalizeAcceleratorKeyToken(segments[0]);
  }
  const keyPart = segments[segments.length - 1];
  const modParts = segments.slice(0, -1).map(normalizeAcceleratorModifierToken);
  return [...modParts, normalizeAcceleratorKeyToken(keyPart)].join("+");
}

/** @param {string} seg */
function normalizeAcceleratorModifierToken(seg) {
  const t = seg.normalize("NFKC").trim();
  const compact = t.toLowerCase().replace(/\s+/g, "");
  const aliases = {
    command: "Command",
    cmd: "Command",
    control: "Control",
    ctrl: "Control",
    commandorcontrol: "CommandOrControl",
    cmdorctrl: "CommandOrControl",
    option: "Option",
    opt: "Option",
    alt: "Alt",
    shift: "Shift",
    super: "Super",
    meta: "Super",
  };
  if (aliases[compact]) return aliases[compact];
  return t;
}

/** @param {string} seg */
function normalizeAcceleratorKeyToken(seg) {
  return seg.normalize("NFKC").trim();
}

function readCoreBearerTokenSync() {
  const p = resolveCoreTokenFilePath();
  try {
    if (!existsSync(p)) return "";
    return readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * 从 Core 拉取 `state === running` 的会话 ID（不依赖 Web 打开会话详情）。
 * @param {string} token
 * @returns {Promise<string[]>}
 */
async function fetchRunningSessionIdsFromCore(token) {
  const base = `http://127.0.0.1:${corePort}`;
  try {
    const res = await fetch(`${base}/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn("[studio-electron-shell][globalShortcut] GET /v1/sessions 失败", { status: res.status });
      return [];
    }
    const data = await res.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions
      .filter((s) => s && String(s.state ?? "").toLowerCase() === "running")
      .map((s) => s.id)
      .filter((id) => typeof id === "string" && id.length > 0);
  } catch (e) {
    console.warn("[studio-electron-shell][globalShortcut] GET /v1/sessions 异常", {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * 解析要调用的会话列表：优先 Web 同步的 `studioShortcutContext.sessionId`；否则用 Core `GET /v1/sessions` 的 running 列表。
 * `vector-record-toggle` 对多个 running 会话各调一次；segment/checkpoint 多会话时仅第一个（避免歧义）。
 * @param {string} actionId
 * @param {string} token
 * @returns {Promise<string[]>}
 */
async function resolveSessionIdsForShortcut(actionId, token) {
  const pinned = typeof studioShortcutContext.sessionId === "string" ? studioShortcutContext.sessionId.trim() : "";
  if (pinned) {
    return [pinned];
  }
  const ids = await fetchRunningSessionIdsFromCore(token);
  if (ids.length === 0) {
    return [];
  }
  const isSeg =
    actionId === "segment-start" || actionId === "segment-end" || actionId === "checkpoint";
  if (isSeg && ids.length > 1) {
    console.info("[studio-electron-shell][globalShortcut] 多 running 会话，打点仅使用第一个", {
      used: ids[0],
      all: ids,
    });
    return [ids[0]];
  }
  return ids;
}

/**
 * 主进程直连 Core `POST /v1/sessions/:sessionId/control/global-shortcut`（不经过 Web）。
 * @param {string} actionId
 */
async function invokeGlobalShortcutControlFromMain(actionId) {
  if (typeof actionId !== "string" || !actionId.trim()) return;
  const token = readCoreBearerTokenSync();
  if (!token) {
    console.warn("[studio-electron-shell][globalShortcut] token.txt 为空，跳过 Core 控制面调用");
    return;
  }
  const sessionIds = await resolveSessionIdsForShortcut(actionId, token);
  if (sessionIds.length === 0) {
    console.warn(
      "[studio-electron-shell][globalShortcut] 无可用会话：请确认 Core 已启动且存在 state=running 的会话（或于 Studio 同步会话以固定作用域）",
    );
    return;
  }
  const base = `http://127.0.0.1:${corePort}`;
  for (const sessionId of sessionIds) {
    const url = `${base}/v1/sessions/${encodeURIComponent(sessionId)}/control/global-shortcut`;
    const body = { actionId };
    if (
      (actionId === "segment-start" || actionId === "segment-end" || actionId === "checkpoint") &&
      typeof studioShortcutContext.targetId === "string" &&
      studioShortcutContext.targetId.trim()
    ) {
      body.targetId = studioShortcutContext.targetId.trim();
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const tx = await res.text();
      let preview = tx.slice(0, 600);
      try {
        const j = JSON.parse(tx);
        preview = JSON.stringify(j).slice(0, 600);
      } catch {
        /* raw */
      }
      console.info("[studio-electron-shell][globalShortcut] Core 控制面响应", {
        actionId,
        sessionId,
        httpStatus: res.status,
        bodyPreview: preview,
      });
    } catch (e) {
      console.warn("[studio-electron-shell][globalShortcut] Core 请求失败", {
        actionId,
        sessionId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

function unregisterAllGlobalShortcuts() {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
}

/**
 * @param {Record<string, string>} bindings actionId → Electron accelerator 字符串
 * @returns {{ ok: boolean; errors: Array<{ actionId: string; accelerator: string; code: string }> }}
 */
function applyGlobalShortcutBindings(bindings) {
  unregisterAllGlobalShortcuts();
  const errors = [];
  if (!bindings || typeof bindings !== "object") {
    return { ok: true, errors: [] };
  }
  /** @type {Map<string, string>} normalized accelerator → 先占用的 actionId */
  const seenAccel = new Map();
  for (const [actionId, acc] of Object.entries(bindings)) {
    if (typeof acc !== "string" || !acc.trim()) continue;
    const accelerator = normalizeElectronAccelerator(acc);
    if (!accelerator) {
      console.info("[studio-electron-shell][globalShortcut] 跳过（规范化后为空）", { actionId, raw: acc });
      continue;
    }
    if (acc.trim() !== accelerator) {
      console.info("[studio-electron-shell][globalShortcut] 规范化", { actionId, raw: acc.trim(), normalized: accelerator });
    }
    const dup = seenAccel.get(accelerator);
    if (dup) {
      errors.push({
        actionId,
        accelerator,
        code: "DUPLICATE_ACCELERATOR",
        otherActionId: dup,
      });
      continue;
    }
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, () => {
        console.info("[studio-electron-shell][globalShortcut] 用户按下已注册快捷键", {
          actionId,
          accelerator,
        });
        void invokeGlobalShortcutControlFromMain(actionId);
      });
    } catch {
      registered = false;
    }
    if (!registered) {
      console.warn(
        "[studio-electron-shell][globalShortcut] register 失败（格式无效、已被系统/其他应用占用，或当前环境限制）：",
        actionId,
        accelerator,
      );
      errors.push({ actionId, accelerator, code: "REGISTER_FAILED" });
    } else {
      console.info("[studio-electron-shell][globalShortcut] 注册成功", { actionId, accelerator });
      seenAccel.set(accelerator, actionId);
    }
  }
  globalShortcutBindingsSnapshot = { ...bindings };
  const summary = { ok: errors.length === 0, errorCount: errors.length, registered: [...seenAccel.keys()] };
  console.info("[studio-electron-shell][globalShortcut] applyGlobalShortcutBindings 结束", summary);
  return { ok: errors.length === 0, errors };
}

function stopQtAxOverlayInternal() {
  if (qtAxCursorInterval) {
    clearInterval(qtAxCursorInterval);
    qtAxCursorInterval = null;
  }
  qtAxLastHitFrameGlobal = null;
  if (qtAxOverlayWindow && !qtAxOverlayWindow.isDestroyed()) {
    try {
      qtAxOverlayWindow.close();
    } catch {
      /* ignore */
    }
  }
  qtAxOverlayWindow = null;
}

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
  ipcMain.handle("od:set-studio-session-context", async (_event, payload) => {
    const p = payload && typeof payload === "object" ? payload : {};
    const sid =
      typeof p.sessionId === "string" && p.sessionId.trim() ? p.sessionId.trim() : null;
    const tid =
      typeof p.targetId === "string" && p.targetId.trim() ? p.targetId.trim() : null;
    studioShortcutContext = { sessionId: sid, targetId: tid };
    console.info("[studio-electron-shell][session-context] 快捷键上下文", studioShortcutContext);
    return { ok: true };
  });

  ipcMain.handle("od:set-global-shortcuts", async (_event, bindings) => {
    const b = bindings && typeof bindings === "object" ? bindings : {};
    console.info("[studio-electron-shell][globalShortcut] IPC od:set-global-shortcuts 收到", {
      actionIds: Object.keys(b),
      bindings: b,
    });
    const result = applyGlobalShortcutBindings(b);
    console.info("[studio-electron-shell][globalShortcut] IPC od:set-global-shortcuts 返回", result);
    return result;
  });

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

  ipcMain.handle("od:qt-ax-overlay-set-highlight", async (_event, rect) => {
    if (rect == null) {
      qtAxLastHitFrameGlobal = null;
      return { ok: true };
    }
    if (
      typeof rect === "object" &&
      typeof rect.x === "number" &&
      typeof rect.y === "number" &&
      typeof rect.width === "number" &&
      typeof rect.height === "number" &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= 0 &&
      rect.height >= 0
    ) {
      qtAxLastHitFrameGlobal = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      return { ok: true };
    }
    qtAxLastHitFrameGlobal = null;
    return { ok: false, error: "INVALID_RECT" };
  });

  /**
   * Qt 会话 AX 捕获：主屏全屏透明层 + 主进程轮询 `screen.getCursorScreenPoint()`，
   * 与 `GET .../native-accessibility-at-point?x=&y=` 使用同一屏幕坐标系。
   * @see docs/studio-shell.md
   */
  ipcMain.handle("od:qt-ax-overlay-start", async () => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "屏幕十字线覆盖层仅支持 macOS" };
    }
    if (qtAxOverlayWindow && !qtAxOverlayWindow.isDestroyed()) {
      return { ok: true };
    }
    if (!studioShellMainWindow || studioShellMainWindow.isDestroyed()) {
      return { ok: false, error: "主窗口未就绪" };
    }
    const p0 = screen.getCursorScreenPoint();
    const { x: bx, y: by, width, height } = screen.getDisplayNearestPoint(p0).bounds;
    qtAxOverlayWindow = new BrowserWindow({
      x: bx,
      y: by,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "overlay-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    try {
      qtAxOverlayWindow.setBackgroundColor("#00000000");
    } catch {
      /* ignore */
    }
    if (process.platform === "darwin") {
      try {
        qtAxOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch {
        /* ignore */
      }
      try {
        qtAxOverlayWindow.setAlwaysOnTop(true, "screen-saver");
      } catch {
        qtAxOverlayWindow.setAlwaysOnTop(true);
      }
    } else {
      qtAxOverlayWindow.setAlwaysOnTop(true);
    }
    const overlayHtml = path.join(__dirname, "overlay.html");
    await qtAxOverlayWindow.loadURL(pathToFileURL(overlayHtml).href);
    qtAxOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
    qtAxOverlayWindow.showInactive();

    /** 略快于十字线，便于指针移出控件后尽快清掉旧矩形（不依赖 Core 下一轮响应）。 */
    const pollMs = 50;
    qtAxCursorInterval = setInterval(() => {
      if (!studioShellMainWindow || studioShellMainWindow.isDestroyed()) {
        stopQtAxOverlayInternal();
        return;
      }
      if (!qtAxOverlayWindow || qtAxOverlayWindow.isDestroyed()) {
        stopQtAxOverlayInternal();
        return;
      }
      const p = screen.getCursorScreenPoint();
      const nb = screen.getDisplayNearestPoint(p).bounds;
      const cur = qtAxOverlayWindow.getBounds();
      if (cur.x !== nb.x || cur.y !== nb.y || cur.width !== nb.width || cur.height !== nb.height) {
        qtAxOverlayWindow.setBounds(nb);
      }
      const b = qtAxOverlayWindow.getBounds();
      const lx = p.x - b.x;
      const ly = p.y - b.y;
      /** 若指针已离开上一帧的 hit 矩形，立即丢弃缓存，避免「人走了矩形还在」的滞后感（新矩形仍等 IPC）。 */
      const gPrev = qtAxLastHitFrameGlobal;
      if (
        gPrev &&
        Number.isFinite(gPrev.x) &&
        Number.isFinite(gPrev.y) &&
        Number.isFinite(gPrev.width) &&
        Number.isFinite(gPrev.height) &&
        gPrev.width > 0 &&
        gPrev.height > 0
      ) {
        const margin = 4;
        const inside =
          p.x >= gPrev.x - margin &&
          p.x <= gPrev.x + gPrev.width + margin &&
          p.y >= gPrev.y - margin &&
          p.y <= gPrev.y + gPrev.height + margin;
        if (!inside) {
          qtAxLastHitFrameGlobal = null;
        }
      }
      /** @type {{ x: number; y: number; width: number; height: number } | null} */
      let highlight = null;
      const g = qtAxLastHitFrameGlobal;
      if (g && Number.isFinite(g.x) && Number.isFinite(g.y)) {
        highlight = {
          x: g.x - b.x,
          y: g.y - b.y,
          width: g.width,
          height: g.height,
        };
      }
      qtAxOverlayWindow.webContents.send("od-overlay-draw", { x: lx, y: ly, highlight });
      studioShellMainWindow.webContents.send("od:qt-ax-cursor", { x: p.x, y: p.y });
    }, pollMs);

    return { ok: true };
  });

  ipcMain.handle("od:qt-ax-overlay-stop", async () => {
    stopQtAxOverlayInternal();
    return { ok: true };
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
  studioShellMainWindow = win;
  win.on("closed", () => {
    unregisterAllGlobalShortcuts();
    stopQtAxOverlayInternal();
    studioShellMainWindow = null;
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
  // Wayland：全局快捷键需 Chromium GlobalShortcutsPortal（Electron 文档）。
  if (process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland") {
    try {
      app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
    } catch {
      /* ignore */
    }
  }

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
    unregisterAllGlobalShortcuts();
    if (quitAfterCleanup) return;
    const hasCore = !!coreChild?.pid;
    const hasVite = !!viteDevChild?.pid;
    if (!hasCore && !hasVite) return;
    e.preventDefault();
    quitAfterCleanup = true;
    unregisterAllGlobalShortcuts();
    stopQtAxOverlayInternal();
    void Promise.all([killCoreChild(), killViteDevChild()]).finally(() => {
      app.quit();
    });
  });
}
