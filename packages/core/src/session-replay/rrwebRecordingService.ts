import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { BrowserCdp, attachToTargetSession, getBrowserWsUrl } from "../cdp/browserClient.js";
import type { SessionManager } from "../session/manager.js";
import { getRrwebInjectBundlePath, isRrwebInjectBundlePresent } from "./rrwebPaths.js";
import type { RecordingHandle } from "./recordingService.js";
import { RrwebSseFanout } from "./rrwebSseFanout.js";

const RRWEB_BINDING = "odOpenDesktopRrweb";

type Subscriber = (json: string) => void;

/**
 * 校验 rrweb 事件 JSON（至少含数字型 `type` 字段）。
 */
export function parseRrwebEventLine(payload: string): string | null {
  try {
    const o = JSON.parse(payload) as { type?: unknown };
    if (o === null || typeof o !== "object") return null;
    if (typeof o.type !== "number") return null;
    return JSON.stringify(o);
  } catch {
    return null;
  }
}

class ActiveRrwebRecording implements RecordingHandle {
  private readonly fanout = new RrwebSseFanout();
  private readonly cdp: BrowserCdp;
  private readonly flatSessionId: string;
  private closed = false;

  constructor(cdp: BrowserCdp, flatSessionId: string) {
    this.cdp = cdp;
    this.flatSessionId = flatSessionId;
  }

  dispatchBindingPayload(payload: string): void {
    const line = parseRrwebEventLine(payload);
    if (!line) return;
    this.fanout.emit(line);
  }

  subscribe(fn: Subscriber): () => void {
    return this.fanout.subscribe(fn);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.fanout.clearSubscribers();
    try {
      await this.cdp.send(
        "Runtime.evaluate",
        {
          expression: `(function(){ if (typeof __odRrwebRecordStop==='function') __odRrwebRecordStop(); })()`,
          awaitPromise: true,
        },
        this.flatSessionId,
      );
    } catch {
      /* 页面可能已销毁 */
    }
    try {
      await this.cdp.send("Runtime.removeBinding", { name: RRWEB_BINDING }, this.flatSessionId);
    } catch {
      /* noop */
    }
    try {
      this.cdp.close();
    } catch {
      /* noop */
    }
  }
}

const rrwebRecordings = new Map<string, RecordingHandle>();

export function rrwebRecordingKey(sessionId: string, targetId: string): string {
  return `${sessionId}::${targetId}::rrweb`;
}

function sweepDeadRrweb(manager: SessionManager): void {
  for (const [key, rec] of [...rrwebRecordings.entries()]) {
    const sessionId = key.split("::")[0] ?? "";
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx || ctx.state !== "running" || !ctx.cdpPort) {
      void rec.close().catch(() => undefined);
      rrwebRecordings.delete(key);
    }
  }
}

export function sweepStaleRrwebRecordings(manager: SessionManager): void {
  sweepDeadRrweb(manager);
}

export async function startRrwebRecording(
  manager: SessionManager,
  sessionId: string,
  targetId: string,
): Promise<{ ok: true } | { error: string; code: string }> {
  sweepDeadRrweb(manager);
  const ctx = manager.getOpsContext(sessionId);
  if (!ctx) return { error: "Session not found", code: "SESSION_NOT_FOUND" };
  if (ctx.state !== "running" || !ctx.cdpPort) {
    return { error: "Session has no active CDP endpoint", code: "CDP_NOT_READY" };
  }
  if (!ctx.allowScriptExecution) {
    return { error: "allowScriptExecution is false for this session", code: "SCRIPT_NOT_ALLOWED" };
  }
  if (!isRrwebInjectBundlePresent()) {
    return {
      error: "rrweb inject bundle not found; build packages/rrweb-inject-bundle",
      code: "RRWEB_BUNDLE_NOT_FOUND",
    };
  }

  const key = rrwebRecordingKey(sessionId, targetId);
  if (rrwebRecordings.has(key)) return { ok: true };

  const bundleSource = readFileSync(getRrwebInjectBundlePath(), "utf8");

  const wsUrl = await getBrowserWsUrl(ctx.cdpPort);
  if (!wsUrl) return { error: "Cannot resolve browser WebSocket URL", code: "CDP_NOT_READY" };

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  } catch (e) {
    try {
      ws.close();
    } catch {
      /* noop */
    }
    return { error: e instanceof Error ? e.message : String(e), code: "CDP_NOT_READY" };
  }

  const cdp = new BrowserCdp(ws);
  let flatSessionId: string;
  try {
    flatSessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, flatSessionId);
    await cdp.send("Runtime.addBinding", { name: RRWEB_BINDING }, flatSessionId);

    const rec = new ActiveRrwebRecording(cdp, flatSessionId);
    cdp.onProtocolEvent = (method, params, eventSessionId) => {
      if (method !== "Runtime.bindingCalled") return;
      if (eventSessionId !== undefined && eventSessionId !== flatSessionId) return;
      const p = params as { name?: string; payload?: string };
      if (p.name !== RRWEB_BINDING) return;
      rec.dispatchBindingPayload(p.payload ?? "");
    };

    const ev = (await cdp.send(
      "Runtime.evaluate",
      { expression: bundleSource, awaitPromise: false },
      flatSessionId,
    )) as { exceptionDetails?: unknown };
    if (ev.exceptionDetails) {
      await rec.close();
      return { error: "rrweb bundle inject failed (Runtime.evaluate exception)", code: "INJECT_FAILED" };
    }

    rrwebRecordings.set(key, rec);
    return { ok: true };
  } catch (e) {
    try {
      cdp.close();
    } catch {
      /* noop */
    }
    return { error: e instanceof Error ? e.message : String(e), code: "CDP_ERROR" };
  }
}

export async function stopRrwebRecording(
  manager: SessionManager,
  sessionId: string,
  targetId: string,
): Promise<{ ok: true } | { error: string; code: string }> {
  sweepDeadRrweb(manager);
  if (!manager.getOpsContext(sessionId)) {
    return { error: "Session not found", code: "SESSION_NOT_FOUND" };
  }
  const key = rrwebRecordingKey(sessionId, targetId);
  const rec = rrwebRecordings.get(key);
  if (!rec) return { error: "rrweb recording is not active for this target", code: "RRWEB_RECORDER_NOT_ACTIVE" };
  await rec.close();
  rrwebRecordings.delete(key);
  return { ok: true };
}

export function isRrwebRecordingActive(sessionId: string, targetId: string): boolean {
  return rrwebRecordings.has(rrwebRecordingKey(sessionId, targetId));
}

export function subscribeRrwebRecording(
  sessionId: string,
  targetId: string,
  fn: Subscriber,
): (() => void) | undefined {
  const rec = rrwebRecordings.get(rrwebRecordingKey(sessionId, targetId));
  if (!rec) return undefined;
  return rec.subscribe(fn);
}

export function resetRrwebRecordingRegistryForTest(): void {
  for (const [, rec] of rrwebRecordings) {
    void rec.close().catch(() => undefined);
  }
  rrwebRecordings.clear();
}

export function testOnly_registerStubRrwebRecording(sessionId: string, targetId: string): {
  emit: (line: string) => void;
  stop: () => Promise<void>;
} {
  const subs = new Set<Subscriber>();
  const key = rrwebRecordingKey(sessionId, targetId);
  const handle: RecordingHandle = {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    async close() {
      subs.clear();
    },
  };
  rrwebRecordings.set(key, handle);
  return {
    emit: (line) => {
      for (const fn of subs) {
        try {
          fn(line);
        } catch {
          /* noop */
        }
      }
    },
    stop: async () => {
      await handle.close();
      rrwebRecordings.delete(key);
    },
  };
}
