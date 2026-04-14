import express, { type Express, type NextFunction, type Request, type Response } from "express";
import httpProxy from "http-proxy";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { CoreConfig } from "../config.js";
import { API_VERSION, PACKAGE_VERSION } from "../constants.js";
import type { SessionManager } from "../session/manager.js";
import type { JsonFileStore } from "../store/jsonStore.js";
import type { AppDefinition, ProfileDefinition, UiRuntime } from "../store/types.js";
import { enrichSessionsWithUiRuntime } from "../store/sessionUiRuntime.js";
import { runConsoleMessageStream } from "../cdp/browserClient.js";
import {
  releaseConsoleStream,
  tryAcquireConsoleStream,
} from "../cdp/consoleStreamLimiter.js";
import {
  releaseNetworkSseStream,
  releaseRuntimeExceptionSseStream,
  tryAcquireNetworkSseStream,
  tryAcquireRuntimeExceptionSseStream,
} from "../cdp/observabilitySseLimiter.js";
import {
  releaseReplaySseStream,
  tryAcquireReplaySseStream,
} from "../session-replay/replaySseLimiter.js";
import {
  isPageRecordingActive,
  POINTER_MOVE_MIN_INTERVAL_MS,
  startPageRecording,
  stopPageRecording,
  subscribePageRecording,
  sweepStalePageRecordings,
} from "../session-replay/recordingService.js";
import {
  releaseRrwebSseStream,
  tryAcquireRrwebSseStream,
} from "../session-replay/rrwebSseLimiter.js";
import { RRWEB_INJECT_BUNDLE_VERSION } from "../session-replay/rrwebPaths.js";
import {
  isRrwebRecordingActive,
  startRrwebRecording,
  stopRrwebRecording,
  subscribeRrwebRecording,
  sweepStaleRrwebRecordings,
} from "../session-replay/rrwebRecordingService.js";
import { NETWORK_SSE_MAX_EVENTS_PER_SECOND, runNetworkObservationStream } from "../cdp/networkObserveStream.js";
import {
  MAX_RUNTIME_EXCEPTION_SSE_PER_MINUTE,
  runRuntimeExceptionStream,
} from "../cdp/runtimeExceptionStream.js";
import { listAgentActionNamesForVersion } from "./agentActionAliases.js";
import { registerObservabilityRoutes } from "./registerObservability.js";
import { domPickArm, domPickCancel, domPickResolve } from "../cdp/domPick.js";
import {
  injectUserScriptsIntoPageTargets,
  type UserScriptInjectResult,
} from "../cdp/injectUserScripts.js";
import { parseUserScriptSource } from "../userScripts/parseUserScriptMetadata.js";
import { collectScriptBodiesForApp } from "../userScripts/collectScriptBodiesForApp.js";
import type { UserScriptRecord } from "../userScripts/types.js";
import {
  pickDarwinExecutablePath,
  resolveDarwinAppBundleToExecutable,
} from "../dialog/pickDarwinExecutablePath.js";
import { pickWindowsExecutablePath } from "../dialog/pickWindowsExecutablePath.js";
import { resolveWindowsShortcutFromPath } from "../shortcut/resolveWindowsShortcut.js";
import { dumpMacAccessibilityTree } from "../nativeAccessibility/macAxTree.js";
import { dumpMacAccessibilityAtPoint } from "../nativeAccessibility/macAxTreeAtPoint.js";
import { getGlobalMousePosition } from "../nativeAccessibility/getGlobalMousePosition.js";
import {
  parseTestRecordingArtifact,
  type TestRecordingPageContext,
} from "../test-recording/artifactSchema.js";
import { validateAppId, validateRecordingId } from "../test-recording/appJsonPaths.js";
import { buildTestRecordingArtifactFromReplayLines } from "../test-recording/buildArtifactFromReplayLines.js";
import { resolveAppIdForSession } from "../test-recording/resolveSessionAppId.js";
import {
  listTestRecordingIds,
  readTestRecordingArtifact,
  writeTestRecordingArtifact,
} from "../test-recording/writeArtifact.js";

export interface AppDeps {
  config: CoreConfig;
  token: string;
  store: JsonFileStore;
  manager: SessionManager;
}

export interface CreateAppResult {
  app: Express;
  cdpProxy: httpProxy;
}

function jsonError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function parseUiRuntimeField(raw: unknown): { ok: true; value: UiRuntime } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: "electron" };
  if (raw === "electron" || raw === "qt") return { ok: true, value: raw };
  return { ok: false, message: "uiRuntime must be 'electron' or 'qt'" };
}

function parsePositiveIntQuery(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** CDP HTTP/WebSocket 常由调试器直连，不强制 Bearer；依赖 Core 仅监听本机。 */
function authMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health" || req.path === "/version") return next();
    if (/^\/sessions\/[^/]+\/cdp/.test(req.path)) return next();
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      return jsonError(res, 401, "UNAUTHORIZED", "Missing or invalid bearer token");
    }
    next();
  };
}

export function createApp(deps: AppDeps): CreateAppResult {
  const { config, token, store, manager } = deps;
  const cdpProxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
  cdpProxy.on("error", (err, _req, res) => {
    if (res && "writeHead" in res && !res.headersSent) {
      jsonError(res as Response, 502, "CDP_PROXY_ERROR", err.message);
    }
  });

  const app = express();
  app.disable("x-powered-by");

  // 允许本机 Vite（如 :5173）跨域调 Core API（显式填 API Base 为 :8787 时）
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "2mb" }));

  const v1 = express.Router();

  v1.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  v1.get("/version", (_req, res) => {
    const capabilities = [
      "list-window",
      "topology",
      "metrics",
      "logs_export",
      "live_console",
      "page_session_replay",
      "session_replay_rrweb",
      ...(process.platform === "darwin"
        ? (["native_accessibility_tree", "native_accessibility_at_point"] as const)
        : []),
      ...(config.enableAgentApi ? (["agent", "snapshot"] as const) : []),
      ...(config.enableExtendedLogFields ? (["extended_logs"] as const) : []),
    ];
    const agentActions = config.enableAgentApi ? listAgentActionNamesForVersion() : undefined;
    res.json({
      api: API_VERSION,
      core: PACKAGE_VERSION,
      capabilities,
      sseObservabilityStreams: ["network", "runtime-exception", "local-proxy", "page-replay", "rrweb"] as const,
      sseObservabilityStreamPaths: {
        network: "/v1/sessions/:sessionId/network/stream",
        runtimeException: "/v1/sessions/:sessionId/runtime-exception/stream",
        localProxy: "/v1/sessions/:sessionId/proxy/stream",
        pageReplay: "/v1/sessions/:sessionId/replay/stream",
        rrweb: "/v1/sessions/:sessionId/rrweb/stream",
      },
      ...(agentActions ? { agentActions: [...agentActions] } : {}),
    });
  });

  v1.use(authMiddleware(token));

  v1.post("/resolve-windows-shortcut", async (req, res) => {
    const body = req.body as { path?: string };
    if (typeof body.path !== "string" || !body.path.trim()) {
      return jsonError(res, 400, "VALIDATION_ERROR", "path required");
    }
    const result = await resolveWindowsShortcutFromPath(body.path.trim());
    if ("error" in result) {
      const status =
        result.error === "NOT_FOUND"
          ? 404
          : result.error === "PLATFORM_UNSUPPORTED" ||
              result.error === "NOT_LNK" ||
              result.error === "PATH_NOT_ABSOLUTE"
            ? 400
            : 422;
      return jsonError(res, status, result.error, result.message);
    }
    res.json(result);
  });

  v1.post("/pick-executable-path", async (_req, res) => {
    const result =
      process.platform === "darwin" ? await pickDarwinExecutablePath() : await pickWindowsExecutablePath();
    if ("error" in result) {
      const status = result.error === "PLATFORM_UNSUPPORTED" ? 400 : 422;
      return jsonError(res, status, result.error, result.message);
    }
    if ("cancelled" in result && result.cancelled) {
      res.json({ cancelled: true });
      return;
    }
    if ("path" in result) {
      res.json({ path: result.path });
      return;
    }
    return jsonError(res, 500, "UNEXPECTED", "unexpected pick result");
  });

  /**
   * 将「浏览」得到的原始路径规范为可 `spawn` 的可执行文件路径（与系统选路对话框经 Core 处理后的语义一致）。
   * - macOS：`*.app` → `Contents/MacOS/<CFBundleExecutable>`
   * - Windows：`*.lnk` → 快捷方式目标（与 `POST /v1/resolve-windows-shortcut` 一致）
   * - 其它：须为已存在的普通文件，返回 `path.resolve` 后的绝对路径
   */
  v1.post("/resolve-executable-path", async (req, res) => {
    const body = req.body as { path?: string };
    if (typeof body.path !== "string" || !body.path.trim()) {
      return jsonError(res, 400, "VALIDATION_ERROR", "path required");
    }
    const raw = body.path.trim();
    if (process.platform === "darwin" && raw.toLowerCase().endsWith(".app")) {
      const resolved = await resolveDarwinAppBundleToExecutable(raw);
      if (!resolved) {
        return jsonError(
          res,
          422,
          "APP_BUNDLE_RESOLVE_FAILED",
          "已选择 .app，但无法从 Info.plist 解析主可执行文件。请改为选择 Contents/MacOS 下的可执行文件。",
        );
      }
      return res.json({ executable: resolved });
    }
    if (process.platform === "win32" && raw.toLowerCase().endsWith(".lnk")) {
      const result = await resolveWindowsShortcutFromPath(raw);
      if ("error" in result) {
        const status =
          result.error === "NOT_FOUND"
            ? 404
            : result.error === "PLATFORM_UNSUPPORTED" ||
                result.error === "NOT_LNK" ||
                result.error === "PATH_NOT_ABSOLUTE"
              ? 400
              : 422;
        return jsonError(res, status, result.error, result.message);
      }
      return res.json({ executable: result.targetPath });
    }
    if (!existsSync(raw) || !statSync(raw).isFile()) {
      return jsonError(res, 400, "NOT_A_FILE", "所选路径不是存在的普通文件");
    }
    return res.json({ executable: path.resolve(raw) });
  });

  v1.get("/apps", async (_req, res) => {
    const data = await store.readApps();
    res.json({ apps: data.apps });
  });

  v1.post("/apps", async (req, res) => {
    const body = req.body as Partial<AppDefinition>;
    if (!body.id || !body.executable) {
      return jsonError(res, 400, "VALIDATION_ERROR", "id and executable required");
    }
    const data = await store.readApps();
    if (data.apps.some((a) => a.id === body.id)) {
      return jsonError(res, 409, "CONFLICT", "App id already exists");
    }
    const ur = parseUiRuntimeField(body.uiRuntime);
    if (!ur.ok) return jsonError(res, 400, "VALIDATION_ERROR", ur.message);
    const appDef: AppDefinition = {
      id: body.id,
      name: body.name ?? body.id,
      executable: body.executable,
      cwd: body.cwd ?? process.cwd(),
      env: body.env ?? {},
      args: body.args ?? [],
      ...(body.uiRuntime !== undefined ? { uiRuntime: ur.value } : {}),
      injectElectronDebugPort: body.injectElectronDebugPort ?? true,
      headless: body.headless === true,
      useDedicatedProxy: body.useDedicatedProxy === true,
      proxyRules: Array.isArray(body.proxyRules) ? body.proxyRules : undefined,
    };
    data.apps.push(appDef);
    await store.writeApps(data.apps);
    res.status(201).json({ app: appDef });
  });

  v1.patch("/apps/:appId", async (req, res) => {
    const { appId } = req.params;
    const body = req.body as Partial<AppDefinition>;
    const data = await store.readApps();
    const idx = data.apps.findIndex((a) => a.id === appId);
    if (idx < 0) return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    const cur = data.apps[idx]!;
    let patchUi: { uiRuntime: UiRuntime } | undefined;
    if (body.uiRuntime !== undefined) {
      const ur = parseUiRuntimeField(body.uiRuntime);
      if (!ur.ok) return jsonError(res, 400, "VALIDATION_ERROR", ur.message);
      patchUi = { uiRuntime: ur.value };
    }
    const next: AppDefinition = {
      ...cur,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.executable === "string" ? { executable: body.executable } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
      ...(body.env !== undefined ? { env: body.env } : {}),
      ...(body.args !== undefined ? { args: body.args } : {}),
      ...(patchUi ?? {}),
      ...(typeof body.injectElectronDebugPort === "boolean" ? { injectElectronDebugPort: body.injectElectronDebugPort } : {}),
      ...(typeof body.headless === "boolean" ? { headless: body.headless } : {}),
      ...(typeof body.useDedicatedProxy === "boolean" ? { useDedicatedProxy: body.useDedicatedProxy } : {}),
      ...(body.proxyRules !== undefined ? { proxyRules: body.proxyRules } : {}),
    };
    data.apps[idx] = next;
    await store.writeApps(data.apps);
    res.json({ app: next });
  });

  v1.delete("/apps/:appId", async (req, res) => {
    const { appId } = req.params;
    const appsData = await store.readApps();
    if (!appsData.apps.some((a) => a.id === appId)) {
      return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    }
    const profData = await store.readProfiles();
    const profileIds = new Set(
      profData.profiles.filter((p) => p.appId === appId).map((p) => p.id),
    );
    await manager.evictSessionsByProfileIds(profileIds);
    await store.writeProfiles(profData.profiles.filter((p) => p.appId !== appId));
    const us = await store.readUserScripts();
    await store.writeUserScripts(us.scripts.filter((x) => x.appId !== appId));
    await store.writeApps(appsData.apps.filter((a) => a.id !== appId));
    res.status(204).send();
  });

  async function appExists(appId: string): Promise<boolean> {
    const data = await store.readApps();
    return data.apps.some((a) => a.id === appId);
  }

  /** 用户脚本（按 app）；`@match` 仅存储，不用于 URL 匹配或自动注入。 */
  v1.get("/apps/:appId/user-scripts", async (req, res) => {
    const { appId } = req.params;
    if (!(await appExists(appId))) {
      return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    }
    const file = await store.readUserScripts();
    const scripts = file.scripts.filter((s) => s.appId === appId);
    res.json({ scripts });
  });

  v1.post("/apps/:appId/user-scripts", async (req, res) => {
    const { appId } = req.params;
    if (!(await appExists(appId))) {
      return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    }
    const body = req.body as { source?: string };
    if (typeof body.source !== "string" || !body.source.trim()) {
      return jsonError(res, 400, "VALIDATION_ERROR", "source required");
    }
    const parsed = parseUserScriptSource(body.source);
    if (!parsed.ok) {
      return jsonError(res, 400, parsed.code, parsed.message);
    }
    const file = await store.readUserScripts();
    const now = new Date().toISOString();
    const rec: UserScriptRecord = {
      id: randomUUID(),
      appId,
      source: body.source,
      metadata: parsed.metadata,
      updatedAt: now,
    };
    file.scripts.push(rec);
    await store.writeUserScripts(file.scripts);
    res.status(201).json({ script: rec });
  });

  v1.get("/apps/:appId/user-scripts/:scriptId", async (req, res) => {
    const { appId, scriptId } = req.params;
    if (!(await appExists(appId))) {
      return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    }
    const file = await store.readUserScripts();
    const script = file.scripts.find((s) => s.id === scriptId && s.appId === appId);
    if (!script) return jsonError(res, 404, "USER_SCRIPT_NOT_FOUND", "script not found");
    res.json({ script });
  });

  v1.patch("/apps/:appId/user-scripts/:scriptId", async (req, res) => {
    const { appId, scriptId } = req.params;
    if (!(await appExists(appId))) {
      return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    }
    const body = req.body as { source?: string };
    if (typeof body.source !== "string" || !body.source.trim()) {
      return jsonError(res, 400, "VALIDATION_ERROR", "source required");
    }
    const parsed = parseUserScriptSource(body.source);
    if (!parsed.ok) {
      return jsonError(res, 400, parsed.code, parsed.message);
    }
    const file = await store.readUserScripts();
    const idx = file.scripts.findIndex((s) => s.id === scriptId && s.appId === appId);
    if (idx < 0) return jsonError(res, 404, "USER_SCRIPT_NOT_FOUND", "script not found");
    const now = new Date().toISOString();
    const updated: UserScriptRecord = {
      ...file.scripts[idx]!,
      source: body.source,
      metadata: parsed.metadata,
      updatedAt: now,
    };
    file.scripts[idx] = updated;
    await store.writeUserScripts(file.scripts);
    res.json({ script: updated });
  });

  v1.delete("/apps/:appId/user-scripts/:scriptId", async (req, res) => {
    const { appId, scriptId } = req.params;
    if (!(await appExists(appId))) {
      return jsonError(res, 404, "APP_NOT_FOUND", "appId does not exist");
    }
    const file = await store.readUserScripts();
    const next = file.scripts.filter((s) => !(s.id === scriptId && s.appId === appId));
    if (next.length === file.scripts.length) {
      return jsonError(res, 404, "USER_SCRIPT_NOT_FOUND", "script not found");
    }
    await store.writeUserScripts(next);
    res.status(204).send();
  });

  v1.get("/profiles", async (_req, res) => {
    const data = await store.readProfiles();
    res.json({ profiles: data.profiles });
  });

  v1.post("/profiles", async (req, res) => {
    const body = req.body as Partial<ProfileDefinition>;
    if (!body.id || !body.appId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "id and appId required");
    }
    const apps = await store.readApps();
    if (!apps.apps.some((a) => a.id === body.appId)) {
      return jsonError(res, 400, "APP_NOT_FOUND", "appId does not exist");
    }
    const data = await store.readProfiles();
    if (data.profiles.some((p) => p.id === body.id)) {
      return jsonError(res, 409, "CONFLICT", "Profile id already exists");
    }
    const prof: ProfileDefinition = {
      id: body.id,
      appId: body.appId,
      name: body.name ?? body.id,
      env: body.env ?? {},
      extraArgs: body.extraArgs ?? [],
      allowScriptExecution: body.allowScriptExecution ?? true,
    };
    data.profiles.push(prof);
    await store.writeProfiles(data.profiles);
    res.status(201).json({ profile: prof });
  });

  v1.get("/sessions", async (_req, res) => {
    const sessions = await enrichSessionsWithUiRuntime(store, manager.list());
    res.json({ sessions });
  });

  v1.post("/sessions", async (req, res) => {
    const profileId = (req.body as { profileId?: string }).profileId;
    if (!profileId) return jsonError(res, 400, "VALIDATION_ERROR", "profileId required");
    try {
      const session = await manager.create(profileId);
      const [enriched] = await enrichSessionsWithUiRuntime(store, [session]);
      res.status(201).json({ session: enriched });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "PROFILE_NOT_FOUND") return jsonError(res, 404, err.code, err.message ?? "");
      if (err.code === "APP_NOT_FOUND") return jsonError(res, 400, err.code, err.message ?? "");
      throw e;
    }
  });

  v1.get("/sessions/:id", async (req, res) => {
    const s = manager.get(req.params.id);
    if (!s) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    const [enriched] = await enrichSessionsWithUiRuntime(store, [s]);
    res.json({ session: enriched });
  });

  /** macOS：按会话子进程 PID 采集系统 Accessibility（AX）UI 树（Qt 等无 CDP 页面）。 */
  v1.get("/sessions/:sessionId/native-accessibility-tree", async (req, res) => {
    if (process.platform !== "darwin") {
      return jsonError(res, 400, "PLATFORM_UNSUPPORTED", "native accessibility tree is only available on macOS");
    }
    const sessionId = req.params.sessionId;
    const s = manager.get(sessionId);
    if (!s) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (s.state !== "running") {
      return jsonError(res, 400, "SESSION_NOT_READY", "Session must be running to dump accessibility tree");
    }
    if (s.pid === undefined || s.pid === null) {
      return jsonError(res, 400, "PID_UNAVAILABLE", "Session has no child process pid yet");
    }
    const maxDepthRaw = req.query.maxDepth;
    const maxNodesRaw = req.query.maxNodes;
    const maxDepth = Math.min(
      50,
      Math.max(1, typeof maxDepthRaw === "string" ? Number.parseInt(maxDepthRaw, 10) || 12 : 12),
    );
    const maxNodes = Math.min(
      50_000,
      Math.max(1, typeof maxNodesRaw === "string" ? Number.parseInt(maxNodesRaw, 10) || 5000 : 5000),
    );
    const result = await dumpMacAccessibilityTree(s.pid, { maxDepth, maxNodes });
    if (!result.ok) {
      if (result.code === "ACCESSIBILITY_DISABLED") {
        return jsonError(
          res,
          403,
          "ACCESSIBILITY_DISABLED",
          result.message ||
            'Grant "Accessibility" to the terminal or opd binary in System Settings → Privacy & Security.',
        );
      }
      const status = result.code === "PLATFORM_UNSUPPORTED" ? 400 : 422;
      return jsonError(res, status, result.code, result.message);
    }
    res.json({
      truncated: result.truncated,
      root: result.root,
    });
  });

  /** macOS：按屏幕坐标（或当前鼠标）在会话 PID 对应应用内命中 AX 元素并返回局部子树。 */
  v1.get("/sessions/:sessionId/native-accessibility-at-point", async (req, res) => {
    if (process.platform !== "darwin") {
      return jsonError(
        res,
        400,
        "PLATFORM_UNSUPPORTED",
        "native accessibility at-point is only available on macOS",
      );
    }
    const sessionId = req.params.sessionId;
    const s = manager.get(sessionId);
    if (!s) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (s.state !== "running") {
      return jsonError(res, 400, "SESSION_NOT_READY", "Session must be running");
    }
    if (s.pid === undefined || s.pid === null) {
      return jsonError(res, 400, "PID_UNAVAILABLE", "Session has no child process pid yet");
    }
    const qx = req.query.x;
    const qy = req.query.y;
    let screenX: number;
    let screenY: number;
    if (typeof qx === "string" && qx.trim() && typeof qy === "string" && qy.trim()) {
      screenX = Number.parseFloat(qx);
      screenY = Number.parseFloat(qy);
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
        return jsonError(res, 400, "VALIDATION_ERROR", "x and y must be finite numbers");
      }
    } else {
      const pos = await getGlobalMousePosition();
      if (!pos.ok) {
        return jsonError(res, 422, pos.code, pos.message);
      }
      screenX = pos.x;
      screenY = pos.y;
    }
    const maxAncestorDepth = Math.min(
      32,
      Math.max(0, parsePositiveIntQuery(req.query.maxAncestorDepth, 8)),
    );
    const maxLocalDepth = Math.min(
      50,
      Math.max(1, parsePositiveIntQuery(req.query.maxLocalDepth, 4)),
    );
    const maxNodes = Math.min(
      50_000,
      Math.max(1, parsePositiveIntQuery(req.query.maxNodes, 5000)),
    );
    const result = await dumpMacAccessibilityAtPoint(s.pid, {
      screenX,
      screenY,
      maxAncestorDepth,
      maxLocalDepth,
      maxNodes,
    });
    if (!result.ok) {
      if (result.code === "ACCESSIBILITY_DISABLED") {
        return jsonError(
          res,
          403,
          "ACCESSIBILITY_DISABLED",
          result.message ||
            'Grant "Accessibility" to the terminal or opd binary in System Settings → Privacy & Security.',
        );
      }
      const status = result.code === "PLATFORM_UNSUPPORTED" ? 400 : 422;
      return jsonError(res, status, result.code, result.message);
    }
    res.json({
      truncated: result.truncated,
      screenX: result.screenX,
      screenY: result.screenY,
      ancestors: result.ancestors,
      at: result.at,
    });
  });

  v1.post("/sessions/:id/stop", async (req, res) => {
    const s = await manager.stop(req.params.id);
    if (!s) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    res.json({ session: s });
  });

  /** 显式将 Profile 所属 app 的用户脚本正文注入当前 CDP 全部 `page` target（不参考 @match）。 */
  v1.post("/sessions/:sessionId/user-scripts/inject", async (req, res) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }
    if (ctx.state !== "running" || ctx.cdpPort === undefined) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }

    const session = manager.get(sessionId);
    if (!session) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    const { profiles } = await store.readProfiles();
    const profile = profiles.find((p) => p.id === session.profileId);
    if (!profile) {
      return jsonError(res, 500, "PROFILE_NOT_FOUND", "Session profile not found in store");
    }

    const bodies = await collectScriptBodiesForApp(store, profile.appId);
    if (bodies.length === 0) {
      return res.status(200).json({ injectedScripts: 0, targets: 0, errors: [] });
    }

    const result: UserScriptInjectResult = await injectUserScriptsIntoPageTargets(
      ctx.cdpPort,
      bodies,
    );
    if ("error" in result) {
      return jsonError(res, 503, "CDP_NOT_READY", result.error);
    }
    return res.status(200).json({
      injectedScripts: result.injectedScripts,
      targets: result.targets,
      errors: result.errors,
    });
  });

  /** DOM 拾取（spike）：注入 pointer 监听 → 用户在被测窗口内点击 → resolve 取节点（单 page target）。 */
  v1.post("/sessions/:sessionId/targets/:targetId/dom-pick/arm", async (req, res) => {
    const { sessionId, targetId } = req.params;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }
    if (ctx.state !== "running" || ctx.cdpPort === undefined) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    const arm = await domPickArm(ctx.cdpPort, targetId);
    if ("error" in arm) {
      return jsonError(res, 503, "CDP_NOT_READY", arm.error);
    }
    return res.status(200).json(arm);
  });

  v1.post("/sessions/:sessionId/targets/:targetId/dom-pick/resolve", async (req, res) => {
    const { sessionId, targetId } = req.params;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }
    if (ctx.state !== "running" || ctx.cdpPort === undefined) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    const result = await domPickResolve(ctx.cdpPort, targetId);
    if (!result.ok) {
      if (result.code === "DOM_PICK_EMPTY") {
        return jsonError(res, 400, result.code, result.message);
      }
      if (result.code === "DOM_PICK_NO_NODE") {
        return jsonError(res, 400, result.code, result.message);
      }
      return jsonError(res, 503, "CDP_NOT_READY", result.message);
    }
    return res.status(200).json({
      pick: result.pick,
      node: result.node,
      highlightApplied: result.highlightApplied,
      highlightMethod: result.highlightMethod,
      highlightOverlayError: result.highlightOverlayError,
      highlightPersistNote: result.highlightPersistNote,
    });
  });

  /** 结束 DOM 拾取：卸监听、清页面标注与 stash */
  v1.post("/sessions/:sessionId/targets/:targetId/dom-pick/cancel", async (req, res) => {
    const { sessionId, targetId } = req.params;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }
    if (ctx.state !== "running" || ctx.cdpPort === undefined) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    const out = await domPickCancel(ctx.cdpPort, targetId);
    if ("error" in out) {
      return jsonError(res, 503, "CDP_NOT_READY", out.error);
    }
    return res.status(200).json(out);
  });

  registerObservabilityRoutes(v1, {
    config,
    manager,
    dataDir: config.dataDir,
  });

  v1.get("/sessions/:sessionId/network/stream", async (req, res) => {
    const q = req.query.targetId;
    const targetId = typeof q === "string" ? q.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId query parameter required");
    }
    const stripQueryRaw = req.query.stripQuery;
    const stripQuery = stripQueryRaw === "false" || stripQueryRaw === "0" ? false : true;
    let maxPerSec = NETWORK_SSE_MAX_EVENTS_PER_SECOND;
    const mps = req.query.maxEventsPerSecond;
    if (typeof mps === "string" && mps.trim()) {
      const n = parseInt(mps, 10);
      if (Number.isFinite(n)) maxPerSec = Math.min(200, Math.max(1, n));
    }

    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }

    if (!tryAcquireNetworkSseStream()) {
      return jsonError(res, 429, "NETWORK_SSE_STREAM_LIMIT", "Too many concurrent network observation streams");
    }

    const ac = new AbortController();
    const onClose = (): void => {
      ac.abort();
    };
    req.on("close", onClose);

    let droppedTotal = 0;
    let lastWarnAt = 0;
    const maybeWarnDropped = (code: string): void => {
      if (res.writableEnded) return;
      const t = Date.now();
      if (t - lastWarnAt < 300) return;
      lastWarnAt = t;
      if (droppedTotal === 0) return;
      res.write(
        `event: warning\ndata: ${JSON.stringify({ code, droppedEvents: droppedTotal })}\n\n`,
      );
    };

    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const readyPayload = {
        sessionId,
        targetId,
        stripQuery,
        maxEventsPerSecond: maxPerSec,
        note: "events are CDP Network request completions after subscribe; no history; rate limit may drop events (see warning)",
      };
      res.write(`event: ready\ndata: ${JSON.stringify(readyPayload)}\n\n`);

      const result = await runNetworkObservationStream(
        ctx.cdpPort,
        targetId,
        {
          stripQuery,
          maxEventsPerSecond: maxPerSec,
          onRequestComplete: (ev) => {
            if (res.writableEnded) return;
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          },
          onDropped: (delta) => {
            droppedTotal += delta;
            maybeWarnDropped("NETWORK_SSE_RATE_LIMIT");
          },
        },
        ac.signal,
      );

      if (result.error && !res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: result.error })}\n\n`);
      }
      if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", onClose);
      releaseNetworkSseStream();
    }
  });

  /** 本地转发代理观测：仅当应用开启 useDedicatedProxy 且会话 running 时可用（与 CDP network/stream 并存） */
  v1.get("/sessions/:sessionId/proxy/stream", async (req, res) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running") {
      return jsonError(res, 503, "SESSION_NOT_READY", "Session is not running");
    }
    if (ctx.localProxyPort === undefined) {
      return jsonError(
        res,
        503,
        "LOCAL_PROXY_NOT_ACTIVE",
        "No local forward proxy for this session (enable useDedicatedProxy on the registered app)",
      );
    }

    const ac = new AbortController();
    const onClose = (): void => {
      ac.abort();
    };
    req.on("close", onClose);

    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      res.write(
        `event: ready\ndata: ${JSON.stringify({
          sessionId,
          localProxyPort: ctx.localProxyPort,
          note: "proxyRequestComplete events; HTTPS is CONNECT tunnel only (no MITM in Phase 1)",
        })}\n\n`,
      );

      const unsub = manager.subscribeProxyNetwork(sessionId, (ev) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      });
      if (!unsub) {
        if (!res.writableEnded) res.end();
        return;
      }

      await new Promise<void>((resolve) => {
        if (ac.signal.aborted) {
          resolve();
          return;
        }
        ac.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      unsub();
      if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", onClose);
    }
  });

  v1.get("/sessions/:sessionId/runtime-exception/stream", async (req, res) => {
    const q = req.query.targetId;
    const targetId = typeof q === "string" ? q.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId query parameter required");
    }

    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }

    if (!tryAcquireRuntimeExceptionSseStream()) {
      return jsonError(
        res,
        429,
        "RUNTIME_EXCEPTION_SSE_STREAM_LIMIT",
        "Too many concurrent runtime exception streams",
      );
    }

    const ac = new AbortController();
    const onClose = (): void => {
      ac.abort();
    };
    req.on("close", onClose);

    let droppedTotal = 0;
    let lastWarnAt = 0;
    const maybeWarnDropped = (): void => {
      if (res.writableEnded) return;
      const t = Date.now();
      if (t - lastWarnAt < 300) return;
      lastWarnAt = t;
      if (droppedTotal === 0) return;
      res.write(
        `event: warning\ndata: ${JSON.stringify({ code: "RUNTIME_EXCEPTION_SSE_RATE_LIMIT", droppedEvents: droppedTotal })}\n\n`,
      );
    };

    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const readyPayload = {
        sessionId,
        targetId,
        maxPerMinute: MAX_RUNTIME_EXCEPTION_SSE_PER_MINUTE,
        note: "events are Runtime.exceptionThrown after subscribe; no history; per-minute cap may drop (see warning)",
      };
      res.write(`event: ready\ndata: ${JSON.stringify(readyPayload)}\n\n`);

      const result = await runRuntimeExceptionStream(
        ctx.cdpPort,
        targetId,
        {
          maxPerMinute: MAX_RUNTIME_EXCEPTION_SSE_PER_MINUTE,
          onException: (payload) => {
            if (res.writableEnded) return;
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          },
          onDropped: (delta) => {
            droppedTotal += delta;
            maybeWarnDropped();
          },
        },
        ac.signal,
      );

      if (result.error && !res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: result.error })}\n\n`);
      }
      if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", onClose);
      releaseRuntimeExceptionSseStream();
    }
  });

  v1.get("/sessions/:sessionId/console/stream", async (req, res) => {
    const q = req.query.targetId;
    const targetId = typeof q === "string" ? q.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId query parameter required");
    }

    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }

    if (!tryAcquireConsoleStream()) {
      return jsonError(res, 429, "CONSOLE_STREAM_LIMIT", "Too many concurrent console streams");
    }

    const ac = new AbortController();
    const onClose = (): void => {
      ac.abort();
    };
    req.on("close", onClose);

    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const payload = {
        sessionId,
        targetId,
        note: "events are CDP Runtime.consoleAPICalled after subscribe; no history",
      };
      res.write(`event: ready\ndata: ${JSON.stringify(payload)}\n\n`);

      const result = await runConsoleMessageStream(ctx.cdpPort, targetId, (entry) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      }, ac.signal);

      if (result.error && !res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: result.error })}\n\n`);
      }
      if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", onClose);
      releaseConsoleStream();
    }
  });

  v1.post("/sessions/:sessionId/replay/recording/start", async (req, res) => {
    const body = req.body as { targetId?: string; injectPageControls?: unknown };
    const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId required");
    }
    const injectPageControls = body?.injectPageControls !== false;
    const sessionId = req.params.sessionId;
    sweepStalePageRecordings(manager);
    const result = await startPageRecording(manager, sessionId, targetId, { injectPageControls });
    if ("error" in result) {
      const code = result.code;
      const status =
        code === "SESSION_NOT_FOUND"
          ? 404
          : code === "SCRIPT_NOT_ALLOWED"
            ? 403
            : code === "CDP_NOT_READY" || code === "INJECT_FAILED"
              ? 503
              : 500;
      return jsonError(res, status, code, result.error);
    }
    res.json({ ok: true, sessionId, targetId });
  });

  v1.post("/sessions/:sessionId/replay/recording/stop", async (req, res) => {
    const body = req.body as { targetId?: string };
    const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId required");
    }
    const sessionId = req.params.sessionId;
    sweepStalePageRecordings(manager);
    const result = await stopPageRecording(manager, sessionId, targetId);
    if ("error" in result) {
      const code = result.code;
      const status =
        code === "SESSION_NOT_FOUND"
          ? 404
          : code === "RECORDER_NOT_ACTIVE"
            ? 409
            : 500;
      return jsonError(res, status, code, result.error);
    }
    res.json({ ok: true, sessionId, targetId });
  });

  v1.post("/sessions/:sessionId/test-recording-artifacts", async (req, res) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running") {
      return jsonError(res, 503, "SESSION_NOT_ACTIVE", "Session is not running");
    }

    const appId = await resolveAppIdForSession(store, manager, sessionId);
    if (!appId) {
      return jsonError(res, 500, "APP_ID_RESOLVE_FAILED", "Could not resolve app for session");
    }

    const body = req.body as {
      targetId?: string;
      recordingId?: string;
      replayLines?: string[];
      notes?: string;
      pageContext?: unknown;
      artifact?: unknown;
    };

    const resolveRecordingId = (): string => {
      const raw =
        typeof body.recordingId === "string" && body.recordingId.trim().length > 0
          ? body.recordingId.trim()
          : randomUUID();
      try {
        validateRecordingId(raw);
        return raw;
      } catch {
        throw new Error("INVALID_RECORDING_ID");
      }
    };

    try {
      if (body.artifact !== undefined && body.artifact !== null) {
        const parsed = parseTestRecordingArtifact(body.artifact);
        if (!parsed) {
          return jsonError(res, 400, "VALIDATION_ERROR", "Invalid test recording artifact");
        }
        if (parsed.sessionId !== sessionId) {
          return jsonError(res, 400, "VALIDATION_ERROR", "artifact.sessionId must match URL");
        }
        if (parsed.appId !== appId) {
          return jsonError(res, 400, "VALIDATION_ERROR", "artifact.appId must match session profile");
        }
        let recordingId: string;
        try {
          recordingId = resolveRecordingId();
        } catch {
          return jsonError(res, 400, "VALIDATION_ERROR", "Invalid recordingId");
        }
        const { absolutePath } = await writeTestRecordingArtifact(
          config.appJsonDir,
          parsed.appId,
          recordingId,
          parsed,
        );
        return res.status(201).json({ ok: true, recordingId, path: absolutePath, artifact: parsed });
      }

      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      if (!targetId) {
        return jsonError(res, 400, "VALIDATION_ERROR", "targetId required when artifact is omitted");
      }
      if (!Array.isArray(body.replayLines)) {
        return jsonError(res, 400, "VALIDATION_ERROR", "replayLines array required when artifact is omitted");
      }

      let recordingId: string;
      try {
        recordingId = resolveRecordingId();
      } catch {
        return jsonError(res, 400, "VALIDATION_ERROR", "Invalid recordingId");
      }

      let pageContext: TestRecordingPageContext | undefined;
      const pcRaw = body.pageContext;
      if (pcRaw !== undefined && pcRaw !== null && typeof pcRaw === "object") {
        const o = pcRaw as Record<string, unknown>;
        if (typeof o.viewportWidth === "number" && typeof o.viewportHeight === "number") {
          pageContext = {
            viewportWidth: o.viewportWidth,
            viewportHeight: o.viewportHeight,
            ...(typeof o.pageUrl === "string" ? { pageUrl: o.pageUrl } : {}),
            ...(typeof o.documentTitle === "string" ? { documentTitle: o.documentTitle } : {}),
          };
        }
      }

      const built = buildTestRecordingArtifactFromReplayLines({
        replayLines: body.replayLines as string[],
        appId,
        sessionId,
        targetId,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        pageContext,
      });

      if (!built.ok) {
        return jsonError(res, 400, "VALIDATION_ERROR", built.error);
      }

      const { absolutePath } = await writeTestRecordingArtifact(
        config.appJsonDir,
        appId,
        recordingId,
        built.artifact,
      );
      return res.status(201).json({ ok: true, recordingId, path: absolutePath, artifact: built.artifact });
    } catch (e) {
      if (e instanceof Error && e.message === "INVALID_RECORDING_ID") {
        return jsonError(res, 400, "VALIDATION_ERROR", "Invalid recordingId");
      }
      throw e;
    }
  });

  v1.get("/apps/:appId/test-recording-artifacts", async (req, res) => {
    const appId = typeof req.params.appId === "string" ? req.params.appId.trim() : "";
    try {
      validateAppId(appId);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "Invalid appId");
    }
    try {
      const recordingIds = await listTestRecordingIds(config.appJsonDir, appId);
      return res.json({ appId, recordingIds });
    } catch (e) {
      return jsonError(res, 500, "LIST_FAILED", e instanceof Error ? e.message : String(e));
    }
  });

  v1.get("/apps/:appId/test-recording-artifacts/:recordingId", async (req, res) => {
    const appId = typeof req.params.appId === "string" ? req.params.appId.trim() : "";
    const recordingId = typeof req.params.recordingId === "string" ? req.params.recordingId.trim() : "";
    try {
      validateAppId(appId);
      validateRecordingId(recordingId);
    } catch {
      return jsonError(res, 400, "VALIDATION_ERROR", "Invalid appId or recordingId");
    }
    const artifact = await readTestRecordingArtifact(config.appJsonDir, appId, recordingId);
    if (!artifact) {
      return jsonError(res, 404, "NOT_FOUND", "Test recording artifact not found");
    }
    return res.json(artifact);
  });

  v1.get("/sessions/:sessionId/replay/stream", async (req, res) => {
    const q = req.query.targetId;
    const targetId = typeof q === "string" ? q.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId query parameter required");
    }
    const sessionId = req.params.sessionId;
    sweepStalePageRecordings(manager);
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }
    if (!isPageRecordingActive(sessionId, targetId)) {
      return jsonError(
        res,
        503,
        "RECORDER_NOT_ACTIVE",
        "Start recording first: POST /v1/sessions/.../replay/recording/start with targetId",
      );
    }
    if (!tryAcquireReplaySseStream()) {
      return jsonError(
        res,
        429,
        "REPLAY_SSE_STREAM_LIMIT",
        "Too many concurrent page replay streams",
      );
    }

    const ac = new AbortController();
    const onClose = (): void => {
      ac.abort();
    };
    req.on("close", onClose);

    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const readyPayload = {
        sessionId,
        targetId,
        pointerMoveThrottleMsCore: POINTER_MOVE_MIN_INTERVAL_MS,
        note: "events are JSON in data frames; pointermove is throttled in page and again in Core",
      };
      res.write(`event: ready\ndata: ${JSON.stringify(readyPayload)}\n\n`);

      const unsub = subscribePageRecording(sessionId, targetId, (line) => {
        if (res.writableEnded) return;
        res.write(`data: ${line}\n\n`);
      });
      if (!unsub) {
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: "RECORDER_NOT_ACTIVE" })}\n\n`);
          res.end();
        }
        return;
      }

      await new Promise<void>((resolve) => {
        if (ac.signal.aborted) {
          resolve();
          return;
        }
        ac.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      unsub();
      if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", onClose);
      releaseReplaySseStream();
    }
  });

  v1.post("/sessions/:sessionId/rrweb/recording/start", async (req, res) => {
    const body = req.body as { targetId?: string };
    const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId required");
    }
    const sessionId = req.params.sessionId;
    sweepStaleRrwebRecordings(manager);
    const result = await startRrwebRecording(manager, sessionId, targetId);
    if ("error" in result) {
      const code = result.code;
      const status =
        code === "SESSION_NOT_FOUND"
          ? 404
          : code === "SCRIPT_NOT_ALLOWED"
            ? 403
            : code === "RRWEB_BUNDLE_NOT_FOUND" || code === "CDP_NOT_READY" || code === "INJECT_FAILED"
              ? 503
              : 500;
      return jsonError(res, status, code, result.error);
    }
    res.json({ ok: true, sessionId, targetId, rrwebBundleVersion: RRWEB_INJECT_BUNDLE_VERSION });
  });

  v1.post("/sessions/:sessionId/targets/:targetId/rrweb/inject", async (req, res) => {
    const targetId = typeof req.params.targetId === "string" ? req.params.targetId.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId required");
    }
    const sessionId = req.params.sessionId;
    sweepStaleRrwebRecordings(manager);
    const result = await startRrwebRecording(manager, sessionId, targetId);
    if ("error" in result) {
      const code = result.code;
      const status =
        code === "SESSION_NOT_FOUND"
          ? 404
          : code === "SCRIPT_NOT_ALLOWED"
            ? 403
            : code === "RRWEB_BUNDLE_NOT_FOUND" || code === "CDP_NOT_READY" || code === "INJECT_FAILED"
              ? 503
              : 500;
      return jsonError(res, status, code, result.error);
    }
    res.json({ ok: true, sessionId, targetId, rrwebBundleVersion: RRWEB_INJECT_BUNDLE_VERSION });
  });

  v1.post("/sessions/:sessionId/rrweb/recording/stop", async (req, res) => {
    const body = req.body as { targetId?: string };
    const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId required");
    }
    const sessionId = req.params.sessionId;
    sweepStaleRrwebRecordings(manager);
    const result = await stopRrwebRecording(manager, sessionId, targetId);
    if ("error" in result) {
      const code = result.code;
      const status =
        code === "SESSION_NOT_FOUND"
          ? 404
          : code === "RRWEB_RECORDER_NOT_ACTIVE"
            ? 409
            : 500;
      return jsonError(res, status, code, result.error);
    }
    res.json({ ok: true, sessionId, targetId });
  });

  v1.get("/sessions/:sessionId/rrweb/stream", async (req, res) => {
    const q = req.query.targetId;
    const targetId = typeof q === "string" ? q.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId query parameter required");
    }
    const sessionId = req.params.sessionId;
    sweepStaleRrwebRecordings(manager);
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }
    if (!isRrwebRecordingActive(sessionId, targetId)) {
      return jsonError(
        res,
        503,
        "RRWEB_RECORDER_NOT_ACTIVE",
        "Start rrweb first: POST /v1/sessions/.../rrweb/recording/start or .../targets/:id/rrweb/inject",
      );
    }
    if (!tryAcquireRrwebSseStream()) {
      return jsonError(res, 429, "RRWEB_SSE_STREAM_LIMIT", "Too many concurrent rrweb streams");
    }

    const ac = new AbortController();
    const onClose = (): void => {
      ac.abort();
    };
    req.on("close", onClose);

    try {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const readyPayload = {
        sessionId,
        targetId,
        rrwebBundleVersion: RRWEB_INJECT_BUNDLE_VERSION,
        note: "data frames are rrweb JSON events (type is numeric); see rrweb EventType",
      };
      res.write(`event: ready\ndata: ${JSON.stringify(readyPayload)}\n\n`);

      const unsub = subscribeRrwebRecording(sessionId, targetId, (line) => {
        if (res.writableEnded) return;
        res.write(`data: ${line}\n\n`);
      });
      if (!unsub) {
        if (!res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: "RRWEB_RECORDER_NOT_ACTIVE" })}\n\n`);
          res.end();
        }
        return;
      }

      await new Promise<void>((resolve) => {
        if (ac.signal.aborted) {
          resolve();
          return;
        }
        ac.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      unsub();
      if (!res.writableEnded) res.end();
    } finally {
      req.removeListener("close", onClose);
      releaseRrwebSseStream();
    }
  });

  v1.get("/sessions/:id/logs/stream", (req, res) => {
    const s = manager.get(req.params.id);
    if (!s) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (line: import("../session/types.js").LogLine) => {
      const payload = config.enableExtendedLogFields
        ? line
        : { ts: line.ts, stream: line.stream, line: line.line };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    for (const line of manager.getLogs(req.params.id)) send(line);
    const unsub = manager.subscribeLogs(req.params.id, send);
    req.on("close", () => {
      unsub?.();
    });
  });

  v1.use("/sessions/:sessionId/cdp", (req, res) => {
    const sessionId = req.params.sessionId;
    const session = manager.get(sessionId);
    if (!session) {
      return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    }
    if (!session.cdpPort || session.state !== "running") {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    const prefix = `/v1/sessions/${sessionId}/cdp`;
    const originalPath = req.originalUrl.split("?")[0] ?? "";
    const query = req.originalUrl.includes("?") ? "?" + req.originalUrl.split("?").slice(1).join("?") : "";
    const rest = originalPath.startsWith(prefix) ? originalPath.slice(prefix.length) || "/" : "/";
    req.url = rest + query;
    cdpProxy.web(req, res, {
      target: `http://127.0.0.1:${session.cdpPort}`,
    });
  });

  app.use("/v1", v1);

  if (config.webDist && existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/v1")) return next();
      const index = path.join(config.webDist!, "index.html");
      if (!existsSync(index)) return next();
      res.sendFile(index);
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  return { app, cdpProxy };
}
