import express, { type Express, type NextFunction, type Request, type Response } from "express";
import httpProxy from "http-proxy";
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
import { listAgentActionNamesForVersion } from "./agentActionAliases.js";
import { registerObservabilityRoutes } from "./registerObservability.js";

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
    };
    data.apps.push(appDef);
    await store.writeApps(data.apps);
    res.status(201).json({ app: appDef });
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
      allowScriptExecution: body.allowScriptExecution ?? false,
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

  registerObservabilityRoutes(v1, {
    config,
    manager,
    dataDir: config.dataDir,
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
