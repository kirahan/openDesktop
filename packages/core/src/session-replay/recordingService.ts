import WebSocket from "ws";
import {
  BrowserCdp,
  attachToTargetSession,
  getBrowserWsUrl,
} from "../cdp/browserClient.js";
import type { SessionManager } from "../session/manager.js";
import {
  createPointerThrottleState,
  throttlePointerMove,
} from "./pointerThrottle.js";
import { parseReplayEnvelopeJsonString } from "./schema.js";

const BINDING_NAME = "odOpenDesktopReplay";
/** 页面内 pointermove 最小间隔 ms；Core 侧二次限流见 {@link POINTER_MOVE_MIN_INTERVAL_MS} */
const PAGE_MOVE_MIN_MS = 50;
const SNAPSHOT_INTERVAL_MS = 12_000;
/** Core 对 pointermove 的最小间隔（毫秒），与页面限流叠加 */
export const POINTER_MOVE_MIN_INTERVAL_MS = 100;

type Subscriber = (json: string) => void;

export type RecordingHandle = {
  subscribe(fn: Subscriber): () => void;
  close(): Promise<void>;
};

class ActiveRecording implements RecordingHandle {
  readonly subscribers = new Set<Subscriber>();
  private readonly pointerState = createPointerThrottleState();
  private readonly cdp: BrowserCdp;
  private readonly flatSessionId: string;
  private closed = false;

  constructor(cdp: BrowserCdp, flatSessionId: string) {
    this.cdp = cdp;
    this.flatSessionId = flatSessionId;
  }

  dispatchBindingPayload(payload: string): void {
    const env = parseReplayEnvelopeJsonString(payload);
    if (!env) return;
    const throttled = throttlePointerMove(env, this.pointerState, POINTER_MOVE_MIN_INTERVAL_MS);
    if (!throttled) return;
    const line = JSON.stringify(throttled);
    for (const fn of this.subscribers) {
      try {
        fn(line);
      } catch {
        /* 订阅者异常不影响其他 */
      }
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.subscribers.clear();
    try {
      await this.cdp.send(
        "Runtime.evaluate",
        {
          expression: `(function(){ if (window.__odReplayCleanupV1) { window.__odReplayCleanupV1(); } })()`,
          awaitPromise: true,
        },
        this.flatSessionId,
      );
    } catch {
      /* 页面可能已销毁 */
    }
    try {
      await this.cdp.send("Runtime.removeBinding", { name: BINDING_NAME }, this.flatSessionId);
    } catch {
      /* 兼容旧协议 */
    }
    try {
      this.cdp.close();
    } catch {
      /* noop */
    }
  }
}

const recordings = new Map<string, RecordingHandle>();

export function recordingMapKey(sessionId: string, targetId: string): string {
  return `${sessionId}::${targetId}`;
}

/**
 * 单元与 HTTP 测试：注册仅占位订阅的录制句柄（不向 CDP 连接）。
 */
export function testOnly_registerStubRecording(sessionId: string, targetId: string): {
  emit: (line: string) => void;
  stop: () => Promise<void>;
} {
  const subs = new Set<Subscriber>();
  const key = recordingMapKey(sessionId, targetId);
  const handle: RecordingHandle = {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    async close() {
      subs.clear();
    },
  };
  recordings.set(key, handle);
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
      recordings.delete(key);
    },
  };
}

function sweepDeadSessions(manager: SessionManager): void {
  for (const [key, rec] of [...recordings.entries()]) {
    const sessionId = key.split("::")[0] ?? "";
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx || ctx.state !== "running" || !ctx.cdpPort) {
      void rec.close().catch(() => undefined);
      recordings.delete(key);
    }
  }
}

/** HTTP 层在每次 replay 相关请求前调用，回收已结束会话的句柄 */
export function sweepStalePageRecordings(manager: SessionManager): void {
  sweepDeadSessions(manager);
}

/**
 * 启动对指定 page target 的矢量录制（CDP Runtime.addBinding + 注入监听脚本）。
 */
export async function startPageRecording(
  manager: SessionManager,
  sessionId: string,
  targetId: string,
): Promise<{ ok: true } | { error: string; code: string }> {
  sweepDeadSessions(manager);
  const ctx = manager.getOpsContext(sessionId);
  if (!ctx) return { error: "Session not found", code: "SESSION_NOT_FOUND" };
  if (ctx.state !== "running" || !ctx.cdpPort) {
    return { error: "Session has no active CDP endpoint", code: "CDP_NOT_READY" };
  }
  if (!ctx.allowScriptExecution) {
    return { error: "allowScriptExecution is false for this session", code: "SCRIPT_NOT_ALLOWED" };
  }

  const key = recordingMapKey(sessionId, targetId);
  if (recordings.has(key)) return { ok: true };

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
    await cdp.send("Runtime.addBinding", { name: BINDING_NAME }, flatSessionId);

    const rec = new ActiveRecording(cdp, flatSessionId);

    cdp.onProtocolEvent = (method, params, eventSessionId) => {
      if (method !== "Runtime.bindingCalled") return;
      if (eventSessionId !== undefined && eventSessionId !== flatSessionId) return;
      const p = params as { name?: string; payload?: string };
      if (p.name !== BINDING_NAME) return;
      rec.dispatchBindingPayload(p.payload ?? "");
    };

    const inject = buildInjectExpression(PAGE_MOVE_MIN_MS, SNAPSHOT_INTERVAL_MS);
    const ev = (await cdp.send(
      "Runtime.evaluate",
      { expression: inject, awaitPromise: true },
      flatSessionId,
    )) as { exceptionDetails?: unknown };
    if (ev.exceptionDetails) {
      await rec.close();
      return { error: "Recorder inject failed (Runtime.evaluate exception)", code: "INJECT_FAILED" };
    }

    recordings.set(key, rec);
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

/**
 * 停止录制并释放 CDP 连接。
 */
export async function stopPageRecording(
  manager: SessionManager,
  sessionId: string,
  targetId: string,
): Promise<{ ok: true } | { error: string; code: string }> {
  sweepDeadSessions(manager);
  if (!manager.getOpsContext(sessionId)) {
    return { error: "Session not found", code: "SESSION_NOT_FOUND" };
  }
  const key = recordingMapKey(sessionId, targetId);
  const rec = recordings.get(key);
  if (!rec) return { error: "Recording is not active for this target", code: "RECORDER_NOT_ACTIVE" };
  await rec.close();
  recordings.delete(key);
  return { ok: true };
}

export function isPageRecordingActive(sessionId: string, targetId: string): boolean {
  return recordings.has(recordingMapKey(sessionId, targetId));
}

export function subscribePageRecording(
  sessionId: string,
  targetId: string,
  fn: Subscriber,
): (() => void) | undefined {
  const rec = recordings.get(recordingMapKey(sessionId, targetId));
  if (!rec) return undefined;
  return rec.subscribe(fn);
}

/** 测试用：清空注册表并关闭连接 */
export function resetRecordingRegistryForTest(): void {
  for (const [, rec] of recordings) {
    void rec.close().catch(() => undefined);
  }
  recordings.clear();
}

function buildInjectExpression(moveMinMs: number, snapshotMs: number): string {
  const move = Number(moveMinMs);
  const snap = Number(snapshotMs);
  return `(function(){
  if (window.__odReplayV1) return "skip";
  window.__odReplayV1 = true;
  var MOVE_MIN = ${move};
  var SNAP_MS = ${snap};
  var send = function(s){
    try { ${BINDING_NAME}(s); } catch (e) {}
  };
  var vp = function(){
    return {
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight
    };
  };
  var odClip = function(s, n){
    if (s === undefined || s === null) return "";
    var t = String(s);
    return t.length <= n ? t : t.slice(0, n);
  };
  var odBuildSelector = function(el, maxDepth, maxLen){
    var parts = [];
    var cur = el;
    var d = 0;
    while (cur && cur.nodeType === 1 && d < maxDepth) {
      var tag = (cur.tagName && cur.tagName.toLowerCase()) || "*";
      if (cur.id) {
        parts.unshift(tag + "#" + odClip(String(cur.id), 180));
        break;
      }
      var cls = "";
      if (typeof cur.className === "string" && cur.className) {
        var ft = cur.className.trim().split(/\\s+/)[0];
        if (ft) cls = "." + odClip(ft, 60);
      }
      var parent = cur.parentElement;
      if (!parent) {
        parts.unshift(tag + cls);
        break;
      }
      var ix = 0;
      var kids = parent.children;
      for (var j = 0; j < kids.length; j++) {
        if (kids[j].tagName === cur.tagName) {
          ix++;
          if (kids[j] === cur) break;
        }
      }
      parts.unshift(tag + cls + ":nth-of-type(" + ix + ")");
      cur = parent;
      d++;
    }
    return odClip(parts.join(" > "), maxLen);
  };
  var odSummarizeClickTarget = function(el){
    var cur = el;
    while (cur && cur.nodeType !== 1) cur = cur.parentElement;
    if (!cur) return { tagName: "unknown" };
    var tagName = (cur.tagName && cur.tagName.toLowerCase()) || "unknown";
    var out = { tagName: odClip(tagName, 32) };
    if (cur.id) out.id = odClip(String(cur.id), 200);
    if (typeof cur.className === "string" && cur.className) out.className = odClip(cur.className, 240);
    var ra = cur.getAttribute && cur.getAttribute("role");
    if (ra) out.role = odClip(String(ra), 64);
    var data = {};
    var dk = 0;
    var attrs = cur.attributes;
    if (attrs) {
      for (var i = 0; i < attrs.length && dk < 12; i++) {
        var nm = attrs[i].name;
        if (nm.indexOf("data-") !== 0) continue;
        if (nm.length > 64) continue;
        if (!/^data-[a-zA-Z0-9_-]+$/.test(nm)) continue;
        data[nm] = odClip(String(attrs[i].value || ""), 200);
        dk++;
      }
    }
    if (Object.keys(data).length) out.data = data;
    out.selector = odBuildSelector(cur, 6, 480);
    return out;
  };
  var lastMove = 0;
  var onMove = function(e){
    var n = performance.now();
    if (n - lastMove < MOVE_MIN) return;
    lastMove = n;
    var v = vp();
    send(JSON.stringify({
      schemaVersion: 1,
      type: "pointermove",
      ts: Date.now(),
      x: e.clientX,
      y: e.clientY,
      viewportWidth: v.vw,
      viewportHeight: v.vh
    }));
  };
  var odInspectLabel = function(el){
    if (!el || el.nodeType !== 1) return "";
    var tag = (el.tagName && el.tagName.toLowerCase()) || "?";
    var head = tag;
    if (el.id) head += "#" + odClip(String(el.id), 48);
    else if (typeof el.className === "string" && el.className) {
      var cs = el.className.trim().split(/\\s+/).slice(0, 3);
      for (var ci = 0; ci < cs.length; ci++) head += "." + odClip(cs[ci], 40);
    }
    var raw = "";
    try {
      raw = el.innerText ? String(el.innerText) : "";
    } catch (e2) { raw = ""; }
    raw = raw.replace(/\\s+/g, " ").trim();
    if (raw.length > 0) {
      var short = raw.length > 48 ? raw.slice(0, 48) + "…" : raw;
      head += ' · "' + short + '"';
    }
    return odClip(head, 220);
  };
  var inspectRoot = document.createElement("div");
  inspectRoot.id = "__odReplayInspectRoot";
  inspectRoot.setAttribute("data-opendesktop-replay-inspect", "1");
  inspectRoot.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:2147483646;";
  var inspectBox = document.createElement("div");
  inspectBox.style.cssText = "position:absolute;display:none;box-sizing:border-box;border:1px solid #2563eb;border-radius:4px;background:rgba(37,99,235,0.06);pointer-events:none;";
  var inspectTip = document.createElement("div");
  inspectTip.style.cssText = "position:absolute;display:none;max-width:min(520px,calc(100vw - 16px));font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#2563eb;color:#fff;padding:4px 8px;border-radius:4px;box-shadow:0 2px 10px rgba(15,23,42,0.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;";
  inspectRoot.appendChild(inspectBox);
  inspectRoot.appendChild(inspectTip);
  document.documentElement.appendChild(inspectRoot);
  var inspectRaf = null;
  var pendingInspectPt = null;
  var flushInspect = function(){
    inspectRaf = null;
    if (!pendingInspectPt) return;
    var px = pendingInspectPt.x;
    var py = pendingInspectPt.y;
    pendingInspectPt = null;
    var el = document.elementFromPoint(px, py);
    if (el && inspectRoot.contains(el)) {
      inspectBox.style.display = "none";
      inspectTip.style.display = "none";
      return;
    }
    if (!el || el.nodeType !== 1) {
      inspectBox.style.display = "none";
      inspectTip.style.display = "none";
      return;
    }
    if (el === document.documentElement || el === document.body) {
      inspectBox.style.display = "none";
      inspectTip.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) {
      inspectBox.style.display = "none";
      inspectTip.style.display = "none";
      return;
    }
    inspectBox.style.display = "block";
    inspectBox.style.left = r.left + "px";
    inspectBox.style.top = r.top + "px";
    inspectBox.style.width = r.width + "px";
    inspectBox.style.height = r.height + "px";
    inspectTip.textContent = odInspectLabel(el);
    inspectTip.style.display = "block";
    var tipH = 28;
    try { tipH = inspectTip.getBoundingClientRect().height || tipH; } catch (e3) {}
    var below = r.bottom + 6;
    if (below + tipH > window.innerHeight - 8 && r.top > tipH + 12) {
      inspectTip.style.left = Math.max(8, r.left) + "px";
      inspectTip.style.top = Math.max(8, r.top - tipH - 6) + "px";
    } else {
      inspectTip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 520)) + "px";
      inspectTip.style.top = Math.min(below, window.innerHeight - tipH - 8) + "px";
    }
  };
  var onInspectMove = function(e){
    pendingInspectPt = { x: e.clientX, y: e.clientY };
    if (inspectRaf !== null) return;
    inspectRaf = requestAnimationFrame(flushInspect);
  };
  var onDown = function(e){
    var v = vp();
    send(JSON.stringify({
      schemaVersion: 1,
      type: "pointerdown",
      ts: Date.now(),
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      viewportWidth: v.vw,
      viewportHeight: v.vh
    }));
  };
  var onClick = function(e){
    var v = vp();
    var tgt = odSummarizeClickTarget(e.target);
    send(JSON.stringify({
      schemaVersion: 1,
      type: "click",
      ts: Date.now(),
      x: e.clientX,
      y: e.clientY,
      viewportWidth: v.vw,
      viewportHeight: v.vh,
      target: tgt
    }));
  };
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointermove", onInspectMove, true);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("click", onClick, true);
  var snapTimer = setInterval(function(){
    try {
      var t = document.body ? document.body.innerText : "";
      if (t.length > 4000) t = t.slice(0, 4000);
      send(JSON.stringify({
        schemaVersion: 1,
        type: "structure_snapshot",
        ts: Date.now(),
        format: "text_digest",
        text: t
      }));
    } catch (e) {}
  }, SNAP_MS);
  window.__odReplayCleanupV1 = function(){
    clearInterval(snapTimer);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointermove", onInspectMove, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("click", onClick, true);
    if (inspectRaf !== null) {
      try {
        cancelAnimationFrame(inspectRaf);
      } catch (e0) {}
      inspectRaf = null;
    }
    try {
      if (inspectRoot && inspectRoot.parentNode) inspectRoot.parentNode.removeChild(inspectRoot);
    } catch (e1) {}
    delete window.__odReplayCleanupV1;
    delete window.__odReplayV1;
  };
  return "ok";
})()`;
}
