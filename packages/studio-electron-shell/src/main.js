/**
 * Studio Electron shell — dev vs production (see `shouldUseCoreDist` / `resolveStudioLoadUrl` below).
 *
 * **Development (`app.isPackaged === false`)**
 * 1. **Core**: default **from source** — `node --import tsx packages/core/src/cli.ts core start …`, not `packages/core/dist/cli.js`.
 *    - Exception: `OPENDESKTOP_ELECTRON_USE_CORE_DIST=1` uses dist/cli.js (CI / built verification).
 * 2. **Web in the Electron window**: default **Vite dev server** `http://127.0.0.1:5173/` (auto `yarn dev:web` or reuse), not `packages/web/dist`.
 *    - Exception: `OPENDESKTOP_STUDIO_USE_CORE_UI=1` loads static UI from Core (needs `web build` and Core `--web-dist`).
 * 3. **Note**: if `packages/web/dist/index.html` exists, `buildCoreStartArgs()` may still pass `--web-dist` for opening `http://127.0.0.1:8787/` in an external browser; this does not conflict with the window defaulting to Vite.
 *
 * **Production (`app.isPackaged === true`)**
 * - **Core**: `dist/cli.js` (packaged layout).
 * - **Window**: `http://127.0.0.1:<core-port>/` served by packaged Core; no Vite.
 *
 * @see docs/studio-shell.md
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
} from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `packages/studio-electron-shell` package root */
const shellRoot = path.resolve(__dirname, "..");
/** monorepo `packages/` */
const packagesDir = path.resolve(shellRoot, "..");
/** Repo root (`yarn dev:web` runs workspace scripts from here) */
const repoRoot = path.resolve(packagesDir, "..");
const coreCliJs = path.join(packagesDir, "core", "dist", "cli.js");
/** Dev: spawn Core from source without a prior build (same idea as `packages/core` cli script) */
const coreCliTs = path.join(packagesDir, "core", "src", "cli.ts");
const defaultWebDist = path.join(packagesDir, "web", "dist");

/** Default data dir aligned with `packages/core/src/config.ts` (for token path resolution) */
function defaultDataDir() {
  const base =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support", "OpenDesktop")
      : process.platform === "win32"
        ? path.join(
            process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"),
            "OpenDesktop",
          )
        : path.join(
            process.env.XDG_DATA_HOME ??
              path.join(homedir(), ".local", "share"),
            "opendesktop",
          );
  return base;
}

/** Align with Core `loadConfig().tokenFile` (OPENDESKTOP_DATA_DIR / OPENDESKTOP_TOKEN_FILE) */
function resolveCoreTokenFilePath() {
  const dataDir = process.env.OPENDESKTOP_DATA_DIR?.trim() || defaultDataDir();
  const tokenFile = process.env.OPENDESKTOP_TOKEN_FILE?.trim();
  return path.resolve(tokenFile || path.join(dataDir, "token.txt"));
}

const DEFAULT_PORT = Number.parseInt(
  process.env.OPENDESKTOP_PORT ?? "8787",
  10,
);
const READY_POLL_MS = 200;
const READY_TIMEOUT_MS = 60_000;
/** Dev default: Vite (`yarn dev:web` / `vite --host 127.0.0.1`, port 5173) */
const DEFAULT_STUDIO_DEV_UI = "http://127.0.0.1:5173/";

/** @type {import('child_process').ChildProcess | null} */
let coreChild = null;
/** Child: `yarn dev:web` (Vite) started by shell; null if Vite was already running */
let viteDevChild = null;
/** @type {number} */
let corePort = Number.isFinite(DEFAULT_PORT) ? DEFAULT_PORT : 8787;
let quitAfterCleanup = false;

/** Main Studio BrowserWindow (for forwarding pointer coords to renderer) */
/** @type {BrowserWindow | null} */
let studioShellMainWindow = null;
/** Full-screen transparent crosshair overlay */
/** @type {BrowserWindow | null} */
let qtAxOverlayWindow = null;
/** @type {ReturnType<typeof setInterval> | null} */
let qtAxCursorInterval = null;
/** Core `hitFrame` in Electron global coords; set from renderer after at-point poll */
/** @type {{ x: number; y: number; width: number; height: number } | null} */
let qtAxLastHitFrameGlobal = null;

/** @type {Record<string, string>} actionId → accelerator (empty = unbound) */
let globalShortcutBindingsSnapshot = {};

/**
 * Synced from Studio Web via `setStudioSessionContext` IPC.
 * `sessionId`: current session; optional `targetId` for vector tab segment/checkpoint scope.
 */
let studioShortcutContext = { sessionId: null, targetId: null };

/**
 * Normalize user input to an Electron accelerator string (full-width symbols, modifier aliases, etc.).
 * @param {string} raw
 * @returns {string} normalized string, or "" if invalid
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
 * Fetch session IDs with `state === running` from Core (no need to open session in Web).
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
      console.warn(
        "[studio-electron-shell][globalShortcut] GET /v1/sessions non-OK",
        { status: res.status },
      );
      return [];
    }
    const data = await res.json();
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions
      .filter((s) => s && String(s.state ?? "").toLowerCase() === "running")
      .map((s) => s.id)
      .filter((id) => typeof id === "string" && id.length > 0);
  } catch (e) {
    console.warn(
      "[studio-electron-shell][globalShortcut] GET /v1/sessions threw",
      {
        message: e instanceof Error ? e.message : String(e),
      },
    );
    return [];
  }
}

/**
 * Resolve session IDs for shortcuts: prefer Web-synced `studioShortcutContext.sessionId`, else Core running list.
 * `vector-record-toggle` calls each running session; segment/checkpoint use first only when multiple.
 * @param {string} actionId
 * @param {string} token
 * @returns {Promise<string[]>}
 */
async function resolveSessionIdsForShortcut(actionId, token) {
  const pinned =
    typeof studioShortcutContext.sessionId === "string"
      ? studioShortcutContext.sessionId.trim()
      : "";
  if (pinned) {
    return [pinned];
  }
  const ids = await fetchRunningSessionIdsFromCore(token);
  if (ids.length === 0) {
    return [];
  }
  const isSeg =
    actionId === "segment-start" ||
    actionId === "segment-end" ||
    actionId === "checkpoint";
  if (isSeg && ids.length > 1) {
    console.info(
      "[studio-electron-shell][globalShortcut] multiple running sessions; segment/checkpoint uses first only",
      {
        used: ids[0],
        all: ids,
      },
    );
    return [ids[0]];
  }
  return ids;
}

/**
 * Main process calls Core `POST /v1/sessions/:sessionId/control/global-shortcut` (not via Web).
 * @param {string} actionId
 */
async function invokeGlobalShortcutControlFromMain(actionId) {
  if (typeof actionId !== "string" || !actionId.trim()) return;
  const token = readCoreBearerTokenSync();
  if (!token) {
    console.warn(
      "[studio-electron-shell][globalShortcut] token.txt empty; skip Core control-plane call",
    );
    return;
  }
  const sessionIds = await resolveSessionIdsForShortcut(actionId, token);
  if (sessionIds.length === 0) {
    console.warn(
      "[studio-electron-shell][globalShortcut] no session: ensure Core is up and a session is running (or sync session in Studio)",
    );
    return;
  }
  const base = `http://127.0.0.1:${corePort}`;
  for (const sessionId of sessionIds) {
    const url = `${base}/v1/sessions/${encodeURIComponent(sessionId)}/control/global-shortcut`;
    const body = { actionId };
    if (
      (actionId === "segment-start" ||
        actionId === "segment-end" ||
        actionId === "checkpoint") &&
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
      console.info(
        "[studio-electron-shell][globalShortcut] Core control-plane response",
        {
          actionId,
          sessionId,
          httpStatus: res.status,
          bodyPreview: preview,
        },
      );
    } catch (e) {
      console.warn(
        "[studio-electron-shell][globalShortcut] Core request failed",
        {
          actionId,
          sessionId,
          message: e instanceof Error ? e.message : String(e),
        },
      );
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
 * @param {Record<string, string>} bindings actionId → Electron accelerator string
 * @returns {{ ok: boolean; errors: Array<{ actionId: string; accelerator: string; code: string }> }}
 */
function applyGlobalShortcutBindings(bindings) {
  unregisterAllGlobalShortcuts();
  const errors = [];
  if (!bindings || typeof bindings !== "object") {
    return { ok: true, errors: [] };
  }
  /** @type {Map<string, string>} normalized accelerator → first actionId using it */
  const seenAccel = new Map();
  for (const [actionId, acc] of Object.entries(bindings)) {
    if (typeof acc !== "string" || !acc.trim()) continue;
    const accelerator = normalizeElectronAccelerator(acc);
    if (!accelerator) {
      console.info(
        "[studio-electron-shell][globalShortcut] skip (empty after normalize)",
        { actionId, raw: acc },
      );
      continue;
    }
    if (acc.trim() !== accelerator) {
      console.info("[studio-electron-shell][globalShortcut] normalized", {
        actionId,
        raw: acc.trim(),
        normalized: accelerator,
      });
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
        console.info(
          "[studio-electron-shell][globalShortcut] accelerator pressed",
          {
            actionId,
            accelerator,
          },
        );
        void invokeGlobalShortcutControlFromMain(actionId);
      });
    } catch {
      registered = false;
    }
    if (!registered) {
      console.warn(
        "[studio-electron-shell][globalShortcut] register failed (invalid, taken by OS/app, or unsupported):",
        actionId,
        accelerator,
      );
      errors.push({ actionId, accelerator, code: "REGISTER_FAILED" });
    } else {
      console.info("[studio-electron-shell][globalShortcut] registered", {
        actionId,
        accelerator,
      });
      seenAccel.set(accelerator, actionId);
    }
  }
  globalShortcutBindingsSnapshot = { ...bindings };
  const summary = {
    ok: errors.length === 0,
    errorCount: errors.length,
    registered: [...seenAccel.keys()],
  };
  console.info(
    "[studio-electron-shell][globalShortcut] applyGlobalShortcutBindings done",
    summary,
  );
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

/** For Core `core start --web-dist`; unrelated to dev Electron window loading Vite (see file header). */
function resolveWebDist() {
  const fromEnv = process.env.OPENDESKTOP_WEB_DIST?.trim();
  if (fromEnv && existsSync(path.join(fromEnv, "index.html")))
    return path.resolve(fromEnv);
  if (existsSync(path.join(defaultWebDist, "index.html")))
    return defaultWebDist;
  return null;
}

/**
 * Unpacked: default `node --import tsx src/cli.ts` (no prior Core build).
 * `OPENDESKTOP_ELECTRON_USE_CORE_DIST=1` forces `dist/cli.js` (production-like).
 * Packaged (`app.isPackaged`): dist only (paths from packager; still resolved via monorepo layout).
 */
function shouldUseCoreDist() {
  if (app.isPackaged) return true;
  return process.env.OPENDESKTOP_ELECTRON_USE_CORE_DIST === "1";
}

function buildCoreStartArgs() {
  const args = [
    "core",
    "start",
    "--port",
    String(corePort),
    "--host",
    "127.0.0.1",
  ];
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
  throw new Error(
    `Core did not become ready within ${READY_TIMEOUT_MS}ms: ${url} — ${lastErr}`,
  );
}

/**
 * True when Studio UI is served from Core on localhost (same origin as `waitForCoreHttpReady`).
 * Otherwise (e.g. Vite) wait for the dev server separately.
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
 * Resolve Studio UI URL for the Electron window.
 * - Dev default: Vite (`DEFAULT_STUDIO_DEV_UI`); `/v1` proxied to Core.
 * - `OPENDESKTOP_STUDIO_USE_CORE_UI=1`: static UI from Core (needs `web build`, usually `--web-dist`).
 * - `OPENDESKTOP_STUDIO_URL`: full override (custom Vite port, etc.).
 */
function resolveStudioLoadUrl() {
  const forced = process.env.OPENDESKTOP_STUDIO_URL?.trim();
  if (forced) {
    const u = forced.endsWith("/") ? forced : `${forced}/`;
    console.info(
      "[studio-electron-shell][diag] using OPENDESKTOP_STUDIO_URL:",
      u,
    );
    return u;
  }
  if (app.isPackaged) {
    const u = `http://127.0.0.1:${corePort}/`;
    console.info(
      "[studio-electron-shell][diag] packaged build; load Core root:",
      u,
    );
    return u;
  }
  if (process.env.OPENDESKTOP_STUDIO_USE_CORE_UI === "1") {
    const u = `http://127.0.0.1:${corePort}/`;
    console.info(
      "[studio-electron-shell][diag] OPENDESKTOP_STUDIO_USE_CORE_UI=1; load Core-hosted web:",
      u,
    );
    return u;
  }
  console.info(
    "[studio-electron-shell][diag] dev default: Vite:",
    DEFAULT_STUDIO_DEV_UI,
  );
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
 * Whether the shell auto-runs `yarn dev:web` in default dev flow (no manual Studio URL override, etc.).
 * `OPENDESKTOP_ELECTRON_SKIP_VITE_SPAWN=1`: do not spawn; poll only (start Vite yourself).
 */
function shouldAutoSpawnViteDev(loadUrl) {
  if (app.isPackaged) return false;
  if (process.env.OPENDESKTOP_STUDIO_USE_CORE_UI === "1") return false;
  if (process.env.OPENDESKTOP_STUDIO_URL?.trim()) return false;
  if (process.env.OPENDESKTOP_ELECTRON_SKIP_VITE_SPAWN === "1") return false;
  if (isStudioUrlServedByCore(loadUrl)) return false;
  return true;
}

/**
 * When `OPENDESKTOP_ELECTRON_VITE_FORWARD_LOG=1`, inherit yarn/vite stdio; plain ANSI to reduce garbling.
 * Set `OPENDESKTOP_ELECTRON_VITE_FANCY_LOG=1` to skip plain-env tweaks (keep full color output).
 */
function envForAutoViteSpawn() {
  const env = { ...process.env };
  if (process.env.OPENDESKTOP_ELECTRON_VITE_FANCY_LOG === "1") return env;
  if (env.NO_COLOR === undefined) env.NO_COLOR = "1";
  if (env.FORCE_COLOR === undefined) env.FORCE_COLOR = "0";
  if (env.CI === undefined) env.CI = "1";
  return env;
}

/** If Studio needs Vite and nothing responds yet, spawn `yarn dev:web` from repo root */
async function ensureViteDevServerRunning(loadUrl) {
  if (isStudioUrlServedByCore(loadUrl)) return;
  if (await isHttpOk(loadUrl)) {
    console.info(
      "[studio-electron-shell][vite] dev server already running:",
      loadUrl,
    );
    return;
  }
  if (!shouldAutoSpawnViteDev(loadUrl)) {
    console.info(
      "[studio-electron-shell][vite] auto-start skipped (see OPENDESKTOP_STUDIO_URL / SKIP_VITE); waiting for external server…",
    );
    return;
  }
  console.info(
    "[studio-electron-shell][vite] starting yarn dev:web (cwd=%s)",
    repoRoot,
  );
  /** Default: discard yarn/vite stdout/stderr so Electron terminal stays clean. `OPENDESKTOP_ELECTRON_VITE_FORWARD_LOG=1` to inherit. */
  const forwardViteLog =
    process.env.OPENDESKTOP_ELECTRON_VITE_FORWARD_LOG === "1";
  /** Windows: direct spawn of yarn.cmd fails with EINVAL; use shell (Node child_process docs). */
  const yarnSpawnOpts = {
    cwd: repoRoot,
    stdio: forwardViteLog ? "inherit" : "ignore",
    env: forwardViteLog ? envForAutoViteSpawn() : { ...process.env },
    windowsHide: false,
    ...(process.platform === "win32" ? { shell: true } : {}),
  };
  viteDevChild = spawn("yarn", ["dev:web"], yarnSpawnOpts);
  viteDevChild.on("exit", (code, signal) => {
    viteDevChild = null;
    if (code !== 0 && code !== null) {
      console.error(
        `[studio-electron-shell][vite] child exited code=${code} signal=${signal ?? ""}`,
      );
    }
  });
  viteDevChild.on("error", (err) => {
    console.error("[studio-electron-shell][vite] spawn error:", err);
  });
}

/** Wait until Vite (or other dev server) responds on GET / */
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
    `Studio dev UI not ready within ${READY_TIMEOUT_MS}ms: ${loadUrl}\n` +
      `Run yarn dev:web manually, or set OPENDESKTOP_STUDIO_URL for a custom port (see docs/studio-shell.md).`,
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
        `Core build output not found: ${coreCliJs}\nRun: yarn workspace @opendesktop/core run build`,
      );
    }
    execArgv = [coreCliJs, ...startArgs];
    console.log("[studio-electron-shell] Core mode: dist/cli.js");
  } else {
    if (!existsSync(coreCliTs)) {
      throw new Error(
        `Core source entry not found: ${coreCliTs}\nSet OPENDESKTOP_ELECTRON_USE_CORE_DIST=1 to use dist/cli.js`,
      );
    }
    execArgv = ["--import", "tsx", coreCliTs, ...startArgs];
    console.log(
      "[studio-electron-shell] Core mode: tsx packages/core/src/cli.ts (dev, no prior build)",
    );
  }
  // In Electron main, process.execPath is Electron, not node; without ELECTRON_RUN_AS_NODE, args like
  // `--import tsx` are treated as Electron CLI ("Unable to find Electron app at …/tsx").
  // ELECTRON_RUN_AS_NODE=1 makes the same binary run as Node (see Electron docs).
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
      console.error(
        `[studio-electron-shell] Core child exited code=${code} signal=${signal ?? ""}`,
      );
    }
  });
  coreChild.on("error", (err) => {
    console.error("[studio-electron-shell] Core child error:", err);
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
  console.info(
    "[studio-electron-shell][diag] token file (same as Core loadConfig):",
    tokenPath,
  );
  console.info(
    "[studio-electron-shell][diag] Dev: Core defaults to tsx; window defaults to Vite. Overrides: OPENDESKTOP_ELECTRON_USE_CORE_DIST / OPENDESKTOP_STUDIO_USE_CORE_UI / OPENDESKTOP_ELECTRON_SKIP_VITE_SPAWN — see docs/studio-shell.md",
  );
}

function registerIpc() {
  ipcMain.handle("od:set-studio-session-context", async (_event, payload) => {
    const p = payload && typeof payload === "object" ? payload : {};
    const sid =
      typeof p.sessionId === "string" && p.sessionId.trim()
        ? p.sessionId.trim()
        : null;
    const tid =
      typeof p.targetId === "string" && p.targetId.trim()
        ? p.targetId.trim()
        : null;
    studioShortcutContext = { sessionId: sid, targetId: tid };
    console.info(
      "[studio-electron-shell][session-context] shortcut context",
      studioShortcutContext,
    );
    return { ok: true };
  });

  ipcMain.handle("od:set-global-shortcuts", async (_event, bindings) => {
    const b = bindings && typeof bindings === "object" ? bindings : {};
    console.info(
      "[studio-electron-shell][globalShortcut] IPC od:set-global-shortcuts recv",
      {
        actionIds: Object.keys(b),
        bindings: b,
      },
    );
    const result = applyGlobalShortcutBindings(b);
    console.info(
      "[studio-electron-shell][globalShortcut] IPC od:set-global-shortcuts result",
      result,
    );
    return result;
  });

  ipcMain.handle("od:read-core-bearer-token", async () => {
    const p = resolveCoreTokenFilePath();
    const exists = existsSync(p);
    console.info(
      "[studio-electron-shell][token] IPC od:read-core-bearer-token",
      {
        path: p,
        exists,
        OPENDESKTOP_DATA_DIR: process.env.OPENDESKTOP_DATA_DIR ?? "(unset)",
        OPENDESKTOP_TOKEN_FILE: process.env.OPENDESKTOP_TOKEN_FILE ?? "(unset)",
      },
    );
    try {
      const raw = readFileSync(p, "utf8");
      const t = raw.trim();
      console.info("[studio-electron-shell][token] read ok", {
        length: t.length,
        preview: t ? `${t.slice(0, 4)}...${t.slice(-2)}` : "(empty)",
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
            title: "Choose app or executable",
            properties: ["openFile", "openDirectory"],
            message:
              "You can select a .app bundle, a Unix executable, or a folder.",
          }
        : process.platform === "win32"
          ? {
              title: "Choose executable",
              properties: ["openFile"],
              filters: [
                { name: "Executable", extensions: ["exe"] },
                { name: "Shortcut", extensions: ["lnk"] },
              ],
            }
          : {
              title: "Choose executable",
              properties: ["openFile"],
            };

    const { canceled, filePaths } = await dialog.showOpenDialog(
      focused ?? undefined,
      props,
    );
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
   * Qt session AX: full-screen transparent layer + main-process poll of `screen.getCursorScreenPoint()`,
   * same coordinate space as `GET .../native-accessibility-at-point?x=&y=`.
   * @see docs/studio-shell.md
   */
  ipcMain.handle("od:qt-ax-overlay-start", async () => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "Qt AX overlay is only supported on macOS" };
    }
    if (qtAxOverlayWindow && !qtAxOverlayWindow.isDestroyed()) {
      return { ok: true };
    }
    if (!studioShellMainWindow || studioShellMainWindow.isDestroyed()) {
      return { ok: false, error: "Main window not ready" };
    }
    const p0 = screen.getCursorScreenPoint();
    const {
      x: bx,
      y: by,
      width,
      height,
    } = screen.getDisplayNearestPoint(p0).bounds;
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
        qtAxOverlayWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
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

    /** Slightly faster than crosshair cadence; clear stale rect when pointer leaves (no Core round-trip). */
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
      if (
        cur.x !== nb.x ||
        cur.y !== nb.y ||
        cur.width !== nb.width ||
        cur.height !== nb.height
      ) {
        qtAxOverlayWindow.setBounds(nb);
      }
      const b = qtAxOverlayWindow.getBounds();
      const lx = p.x - b.x;
      const ly = p.y - b.y;
      /** If pointer left last hit rect, drop cache immediately (new rect still from IPC). */
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
      qtAxOverlayWindow.webContents.send("od-overlay-draw", {
        x: lx,
        y: ly,
        highlight,
      });
      studioShellMainWindow.webContents.send("od:qt-ax-cursor", {
        x: p.x,
        y: p.y,
      });
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
    console.log("[studio-electron-shell][diag] loadUrl ->1", loadUrl);
    await ensureViteDevServerRunning(loadUrl);
    await waitForStudioDevServerReady(loadUrl);
    console.info("[studio-electron-shell][diag] loadURL ->2", loadUrl);
    await win.loadURL(loadUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await dialog.showErrorBox(
      "OpenDesktop Studio",
      `Failed to start Core or load UI:\n${msg}`,
    );
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Wayland: global shortcuts need Chromium GlobalShortcutsPortal (Electron docs).
  if (
    process.platform === "linux" &&
    process.env.XDG_SESSION_TYPE === "wayland"
  ) {
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
