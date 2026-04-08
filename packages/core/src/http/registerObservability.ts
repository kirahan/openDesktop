import { Router, type Request, type Response } from "express";
import { appendAudit } from "../audit.js";
import {
  bringTargetPageToFront,
  captureTargetScreenshot,
  clickOnTarget,
  closeTarget,
  collectConsoleMessagesForTarget,
  evaluateOnTarget,
  getNetworkCookiesForTarget,
  getTargetDocumentOuterHtml,
  getTargetWindowState,
  keysOnTarget,
  navigateBackOnTarget,
  openTargetUrl,
  scrollOnTarget,
  selectOnTarget,
  typeOnTarget,
  waitOnTarget,
} from "../cdp/browserClient.js";
import {
  isLegacyAgentActionAlias,
  isSupportedAgentCanonical,
  normalizeAgentAction,
} from "./agentActionAliases.js";
import type { CoreConfig } from "../config.js";
import { sampleProcessMetrics } from "../metrics/sampleProcess.js";
import type { SessionManager } from "../session/manager.js";
import type { LogLine } from "../session/types.js";
import { collectTopologySnapshot } from "../topology/fetchTopology.js";
import { agentRateLimitMiddleware } from "./rateLimit.js";
import { buildOodaSnapshot } from "./snapshotBuilder.js";

function jsonError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function filterLogs(
  logs: LogLine[],
  level?: string,
  source?: string,
  webContentsId?: string,
): LogLine[] {
  return logs.filter((l) => {
    if (level && (l.level ?? "") !== level) return false;
    if (source && (l.source ?? "") !== source) return false;
    if (webContentsId !== undefined && webContentsId !== "" && String(l.webContentsId ?? "") !== webContentsId)
      return false;
    return true;
  });
}

export interface ObsDeps {
  config: CoreConfig;
  manager: SessionManager;
  dataDir: string;
}

export function registerObservabilityRoutes(v1: Router, deps: ObsDeps): void {
  const { config, manager, dataDir } = deps;

  async function sendListWindowSnapshot(req: Request, res: Response) {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    try {
      const snap = await collectTopologySnapshot(sessionId, ctx.cdpPort);
      res.json(snap);
    } catch (e) {
      jsonError(res, 502, "LIST_WINDOW_FAILED", e instanceof Error ? e.message : String(e));
    }
  }

  /** 用户向命名：窗口/调试目标列表（原 topology） */
  v1.get("/sessions/:sessionId/list-window", sendListWindowSnapshot);
  /** @deprecated 使用 `/list-window` */
  v1.get("/sessions/:sessionId/topology", sendListWindowSnapshot);

  v1.get("/sessions/:sessionId/metrics", async (req, res) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running") {
      return jsonError(res, 503, "SESSION_NOT_READY", "Session not running");
    }
    const r = await sampleProcessMetrics(ctx.pid);
    res.status(200).json({
      sessionId,
      sampledAt: r.metrics?.sampledAt,
      metrics: r.metrics,
      reason: r.reason,
    });
  });

  v1.get("/sessions/:sessionId/logs/export", (req, res) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    const format = (req.query.format as string) || "jsonl";
    const level = req.query.level as string | undefined;
    const source = req.query.source as string | undefined;
    const webContentsId = req.query.webContentsId as string | undefined;
    let logs = manager.getLogs(sessionId);
    logs = filterLogs(logs, level, source, webContentsId);
    const payload = logs.map((l) =>
      config.enableExtendedLogFields ? l : { ts: l.ts, stream: l.stream, line: l.line },
    );
    if (format === "txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(
        payload.map((p) => (typeof p === "object" && "line" in p ? String((p as LogLine).line) : JSON.stringify(p))).join("\n"),
      );
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.send(payload.map((p) => JSON.stringify(p)).join("\n") + (payload.length ? "\n" : ""));
  });

  if (!config.enableAgentApi) return;

  const agent = Router();
  agent.use(agentRateLimitMiddleware(config.agentRateLimitPerMinute, dataDir));

  agent.get("/sessions/:sessionId/snapshot", async (req, res) => {
    const sessionId = req.params.sessionId;
    const built = await buildOodaSnapshot(manager, sessionId);
    if (!built.ok) {
      if (built.code === "NOT_FOUND") return jsonError(res, 404, "SESSION_NOT_FOUND", built.message);
      return jsonError(res, 503, "SNAPSHOT_NOT_READY", built.message);
    }
    res.json(built.snapshot);
  });

  agent.post("/sessions/:sessionId/actions", async (req, res) => {
    const sessionId = req.params.sessionId;
    const body = req.body as {
      action?: string;
      targetId?: string;
      expression?: string;
      /** 控制台采样等待毫秒（console-messages） */
      waitMs?: number;
      url?: string;
      urls?: unknown;
      selector?: string;
      text?: string;
      value?: string;
      key?: string;
      deltaX?: number;
      deltaY?: number;
      ms?: number;
      timeoutMs?: number;
    };
    const actionRaw = typeof body.action === "string" ? body.action.trim() : "";
    if (!actionRaw) return jsonError(res, 400, "VALIDATION_ERROR", "action required");

    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }

    const canonical = normalizeAgentAction(actionRaw);
    if (!isSupportedAgentCanonical(canonical)) {
      await appendAudit(dataDir, {
        type: "agent.action",
        sessionId,
        action: actionRaw,
        ok: false,
        reason: "unknown_action",
      }).catch(() => undefined);
      return jsonError(res, 400, "UNKNOWN_ACTION", `Unknown action: ${actionRaw}`);
    }

    const audit = async (ok: boolean, extra?: Record<string, unknown>) => {
      await appendAudit(dataDir, {
        type: "agent.action",
        sessionId,
        action: actionRaw,
        ...(isLegacyAgentActionAlias(actionRaw) ? { canonicalAction: canonical } : {}),
        ok,
        ...extra,
      }).catch(() => undefined);
    };

    try {
      if (canonical === "state") {
        const snap = await collectTopologySnapshot(sessionId, ctx.cdpPort);
        await audit(true);
        return res.json({ result: snap });
      }
      if (canonical === "screenshot") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const shot = await captureTargetScreenshot(ctx.cdpPort, body.targetId);
        if ("error" in shot) {
          await audit(false, { reason: shot.error });
          return jsonError(res, 502, "SCREENSHOT_FAILED", shot.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ mime: shot.mime, data: shot.base64 });
      }
      if (canonical === "get") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const dom = await getTargetDocumentOuterHtml(ctx.cdpPort, body.targetId);
        if ("error" in dom) {
          await audit(false, { reason: dom.error });
          return jsonError(res, 502, "DOM_FAILED", dom.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ html: dom.html, truncated: dom.truncated });
      }
      if (canonical === "eval") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId || body.expression === undefined) {
          await audit(false, { reason: "missing_params" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId and expression required for ${actionRaw}`);
        }
        const ev = await evaluateOnTarget(ctx.cdpPort, body.targetId, body.expression);
        if ("error" in ev) {
          await audit(false, { reason: ev.error });
          return jsonError(res, 502, "EVAL_FAILED", ev.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ result: ev.result, type: ev.type });
      }
      if (canonical === "console-messages") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const waitMs =
          typeof body.waitMs === "number" && Number.isFinite(body.waitMs) ? body.waitMs : 2000;
        const cons = await collectConsoleMessagesForTarget(ctx.cdpPort, body.targetId, waitMs);
        if ("error" in cons) {
          await audit(false, { reason: cons.error });
          return jsonError(res, 502, "CONSOLE_FAILED", cons.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ entries: cons.entries, note: cons.note, waitMs });
      }
      if (canonical === "init") {
        await audit(true);
        return res.json({
          ok: true,
          note: "无需额外初始化：Core 会话已就绪。可直接使用 state / open / get 等动作。",
        });
      }
      if (canonical === "open") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId || typeof body.url !== "string" || !body.url.trim()) {
          await audit(false, { reason: "missing_params" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId and url required for ${actionRaw}`);
        }
        const opened = await openTargetUrl(ctx.cdpPort, body.targetId, body.url.trim());
        if ("error" in opened) {
          await audit(false, { reason: opened.error });
          return jsonError(res, 502, "OPEN_FAILED", opened.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "network") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const urls = Array.isArray(body.urls)
          ? body.urls.filter((u): u is string => typeof u === "string" && u.length > 0)
          : undefined;
        const net = await getNetworkCookiesForTarget(
          ctx.cdpPort,
          body.targetId,
          urls?.length ? urls : undefined,
        );
        if ("error" in net) {
          await audit(false, { reason: net.error });
          return jsonError(res, 502, "NETWORK_FAILED", net.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ cookies: net.cookies });
      }
      if (canonical === "click") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId || typeof body.selector !== "string" || !body.selector.trim()) {
          await audit(false, { reason: "missing_params" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId and selector required for ${actionRaw}`);
        }
        const r = await clickOnTarget(ctx.cdpPort, body.targetId, body.selector.trim());
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "CLICK_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "type") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (
          !body.targetId ||
          typeof body.selector !== "string" ||
          !body.selector.trim() ||
          typeof body.text !== "string"
        ) {
          await audit(false, { reason: "missing_params" });
          return jsonError(
            res,
            400,
            "VALIDATION_ERROR",
            `targetId, selector and text required for ${actionRaw}`,
          );
        }
        const r = await typeOnTarget(ctx.cdpPort, body.targetId, body.selector.trim(), body.text);
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "TYPE_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "select") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (
          !body.targetId ||
          typeof body.selector !== "string" ||
          !body.selector.trim() ||
          typeof body.value !== "string"
        ) {
          await audit(false, { reason: "missing_params" });
          return jsonError(
            res,
            400,
            "VALIDATION_ERROR",
            `targetId, selector and value required for ${actionRaw}`,
          );
        }
        const r = await selectOnTarget(ctx.cdpPort, body.targetId, body.selector.trim(), body.value);
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "SELECT_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "keys") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId || typeof body.key !== "string" || !body.key.trim()) {
          await audit(false, { reason: "missing_params" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId and key required for ${actionRaw}`);
        }
        const r = await keysOnTarget(ctx.cdpPort, body.targetId, body.key.trim());
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "KEYS_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "scroll") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const selector = typeof body.selector === "string" ? body.selector.trim() : "";
        const r = await scrollOnTarget(ctx.cdpPort, body.targetId, {
          selector: selector || undefined,
          deltaX: body.deltaX,
          deltaY: body.deltaY,
        });
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "SCROLL_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "wait") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const hasMs = typeof body.ms === "number" && Number.isFinite(body.ms) && body.ms > 0;
        const hasSel = typeof body.selector === "string" && body.selector.trim().length > 0;
        if (!hasMs && !hasSel) {
          await audit(false, { reason: "missing_params" });
          return jsonError(
            res,
            400,
            "VALIDATION_ERROR",
            `ms and/or selector required for ${actionRaw}`,
          );
        }
        if (hasSel && !ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        const tm =
          typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs)
            ? body.timeoutMs
            : undefined;
        const r = await waitOnTarget(ctx.cdpPort, body.targetId, {
          ms: hasMs ? body.ms : undefined,
          selector: hasSel ? body.selector!.trim() : undefined,
          timeoutMs: tm,
        });
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "WAIT_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "back") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const r = await navigateBackOnTarget(ctx.cdpPort, body.targetId);
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "BACK_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "verify") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId || body.expression === undefined || body.expression === "") {
          await audit(false, { reason: "missing_params" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId and expression required for ${actionRaw}`);
        }
        const ev = await evaluateOnTarget(ctx.cdpPort, body.targetId, body.expression);
        if ("error" in ev) {
          await audit(false, { reason: ev.error });
          return jsonError(res, 502, "VERIFY_FAILED", ev.error);
        }
        const ok = Boolean(ev.result);
        if (!ok) {
          await audit(false, { reason: "not_truthy" });
          return jsonError(
            res,
            400,
            "VERIFY_FAILED",
            "expression did not yield a truthy value",
          );
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true, result: ev.result, type: ev.type });
      }
      if (canonical === "close") {
        if (!ctx.allowScriptExecution) {
          await audit(false, { reason: "script_disabled" });
          return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
        }
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const r = await closeTarget(ctx.cdpPort, body.targetId);
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "CLOSE_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      if (canonical === "window-state") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const st = await getTargetWindowState(ctx.cdpPort, body.targetId, {
          includePageMetrics: ctx.allowScriptExecution,
        });
        if ("error" in st) {
          await audit(false, { reason: st.error });
          return jsonError(res, 502, "WINDOW_STATE_FAILED", st.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json(st);
      }
      if (canonical === "focus-window") {
        if (!body.targetId) {
          await audit(false, { reason: "missing_targetId" });
          return jsonError(res, 400, "VALIDATION_ERROR", `targetId required for ${actionRaw}`);
        }
        const r = await bringTargetPageToFront(ctx.cdpPort, body.targetId);
        if ("error" in r) {
          await audit(false, { reason: r.error });
          return jsonError(res, 502, "FOCUS_WINDOW_FAILED", r.error);
        }
        await audit(true, { targetId: body.targetId });
        return res.json({ ok: true });
      }
      return jsonError(res, 500, "INTERNAL_ERROR", `Unhandled agent action: ${canonical}`);
    } catch (e) {
      await audit(false, { reason: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  });

  v1.use("/agent", agent);
}
