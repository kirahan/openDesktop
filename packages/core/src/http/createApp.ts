import express, { type Express, type NextFunction, type Request, type Response } from "express";
import httpProxy from "http-proxy";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import type { CoreConfig } from "../config.js";
import { API_VERSION, PACKAGE_VERSION } from "../constants.js";
import type { SessionManager } from "../session/manager.js";
import type { JsonFileStore } from "../store/jsonStore.js";
import type { AppDefinition, ProfileDefinition } from "../store/types.js";
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
      ...(config.enableAgentApi ? (["agent", "snapshot"] as const) : []),
      ...(config.enableExtendedLogFields ? (["extended_logs"] as const) : []),
    ];
    const agentActions = config.enableAgentApi ? listAgentActionNamesForVersion() : undefined;
    res.json({
      api: API_VERSION,
      core: PACKAGE_VERSION,
      capabilities,
      sseObservabilityStreams: ["network", "runtime-exception", "local-proxy"] as const,
      sseObservabilityStreamPaths: {
        network: "/v1/sessions/:sessionId/network/stream",
        runtimeException: "/v1/sessions/:sessionId/runtime-exception/stream",
        localProxy: "/v1/sessions/:sessionId/proxy/stream",
      },
      ...(agentActions ? { agentActions: [...agentActions] } : {}),
    });
  });

  v1.use(authMiddleware(token));

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
    const appDef: AppDefinition = {
      id: body.id,
      name: body.name ?? body.id,
      executable: body.executable,
      cwd: body.cwd ?? process.cwd(),
      env: body.env ?? {},
      args: body.args ?? [],
      injectElectronDebugPort: body.injectElectronDebugPort ?? true,
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
    const next: AppDefinition = {
      ...cur,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.executable === "string" ? { executable: body.executable } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
      ...(body.env !== undefined ? { env: body.env } : {}),
      ...(body.args !== undefined ? { args: body.args } : {}),
      ...(typeof body.injectElectronDebugPort === "boolean" ? { injectElectronDebugPort: body.injectElectronDebugPort } : {}),
      ...(typeof body.useDedicatedProxy === "boolean" ? { useDedicatedProxy: body.useDedicatedProxy } : {}),
      ...(body.proxyRules !== undefined ? { proxyRules: body.proxyRules } : {}),
    };
    data.apps[idx] = next;
    await store.writeApps(data.apps);
    res.json({ app: next });
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

  v1.get("/sessions", (_req, res) => {
    res.json({ sessions: manager.list() });
  });

  v1.post("/sessions", async (req, res) => {
    const profileId = (req.body as { profileId?: string }).profileId;
    if (!profileId) return jsonError(res, 400, "VALIDATION_ERROR", "profileId required");
    try {
      const session = await manager.create(profileId);
      res.status(201).json({ session });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "PROFILE_NOT_FOUND") return jsonError(res, 404, err.code, err.message ?? "");
      if (err.code === "APP_NOT_FOUND") return jsonError(res, 400, err.code, err.message ?? "");
      throw e;
    }
  });

  v1.get("/sessions/:id", (req, res) => {
    const s = manager.get(req.params.id);
    if (!s) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    res.json({ session: s });
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
