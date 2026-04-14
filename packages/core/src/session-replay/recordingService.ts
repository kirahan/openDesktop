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
/** 页面内控制条指令（停止录制、断言检查点等），与数据 binding 分离 */
export const REPLAY_UI_BINDING_NAME = "odOpenDesktopReplayUi";
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

/** 页面注入脚本里 UI binding 的 JSON 载荷（不启停录制，仅打标） */
export type ReplayUiCommand =
  | { kind: "segment_start"; note?: string }
  | { kind: "segment_end"; note?: string }
  | { kind: "checkpoint"; note?: string };

const MAX_UI_NOTE_LEN = 500;
/** UI 标记行在 SSE 连接前产生时暂存，新订阅者会补发，避免丢失 */
const UI_CATCH_UP_BUFFER_CAP = 32;

/**
 * 解析 `REPLAY_UI_BINDING_NAME` 的 payload（供单测与 Core 路由）。
 */
export function parseReplayUiCommand(payload: string): ReplayUiCommand | null {
  try {
    const cmd = JSON.parse(payload) as unknown;
    if (!cmd || typeof cmd !== "object") return null;
    const o = cmd as { cmd?: unknown; note?: unknown };
    if (o.cmd === "segment_start") {
      if (o.note !== undefined && typeof o.note !== "string") return null;
      const note =
        typeof o.note === "string" && o.note.length > 0
          ? o.note.length > MAX_UI_NOTE_LEN
            ? o.note.slice(0, MAX_UI_NOTE_LEN)
            : o.note
          : undefined;
      return { kind: "segment_start", note };
    }
    if (o.cmd === "segment_end") {
      if (o.note !== undefined && typeof o.note !== "string") return null;
      const note =
        typeof o.note === "string" && o.note.length > 0
          ? o.note.length > MAX_UI_NOTE_LEN
            ? o.note.slice(0, MAX_UI_NOTE_LEN)
            : o.note
          : undefined;
      return { kind: "segment_end", note };
    }
    if (o.cmd === "checkpoint") {
      if (o.note !== undefined && typeof o.note !== "string") return null;
      const note =
        typeof o.note === "string" && o.note.length > 0
          ? o.note.length > MAX_UI_NOTE_LEN
            ? o.note.slice(0, MAX_UI_NOTE_LEN)
            : o.note
          : undefined;
      return { kind: "checkpoint", note };
    }
    return null;
  } catch {
    return null;
  }
}

export type StartPageRecordingOptions = {
  /**
   * 为 false 时不注入页面控制条；省略或其它值视为 true（默认开启）。
   */
  injectPageControls?: boolean;
}

class ActiveRecording implements RecordingHandle {
  readonly subscribers = new Set<Subscriber>();
  private readonly pointerState = createPointerThrottleState();
  private readonly uiCatchUpBuffer: string[] = [];
  private readonly cdp: BrowserCdp;
  private readonly flatSessionId: string;
  private readonly registerUiBinding: boolean;
  private closed = false;

  constructor(cdp: BrowserCdp, flatSessionId: string, registerUiBinding: boolean) {
    this.cdp = cdp;
    this.flatSessionId = flatSessionId;
    this.registerUiBinding = registerUiBinding;
  }

  /** 向 SSE 推送一条 UI 标记行（检查点 / 段起止），并写入补发缓冲 */
  private pushUiMarkerLine(line: string): void {
    if (this.uiCatchUpBuffer.length >= UI_CATCH_UP_BUFFER_CAP) {
      this.uiCatchUpBuffer.shift();
    }
    this.uiCatchUpBuffer.push(line);
    for (const fn of this.subscribers) {
      try {
        fn(line);
      } catch {
        /* noop */
      }
    }
  }

  private emitUiMarkerType(
    type: "assertion_checkpoint" | "segment_start" | "segment_end",
    note?: string,
  ): void {
    const payload: Record<string, unknown> = {
      schemaVersion: 1,
      type,
      ts: Date.now(),
    };
    if (typeof note === "string" && note.length > 0) {
      payload.note = note.length > MAX_UI_NOTE_LEN ? note.slice(0, MAX_UI_NOTE_LEN) : note;
    }
    this.pushUiMarkerLine(JSON.stringify(payload));
  }

  /** 由 Core 侧 UI binding 调用，向 SSE 推送 assertion_checkpoint 行 */
  emitAssertionCheckpoint(note?: string): void {
    this.emitUiMarkerType("assertion_checkpoint", note);
  }

  /** 段开始标记（多段连续操作） */
  emitSegmentStart(note?: string): void {
    this.emitUiMarkerType("segment_start", note);
  }

  /** 段结束标记 */
  emitSegmentEnd(note?: string): void {
    this.emitUiMarkerType("segment_end", note);
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
    for (const line of this.uiCatchUpBuffer) {
      try {
        fn(line);
      } catch {
        /* noop */
      }
    }
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** Studio / HTTP 投递的 UI 标记（与页面内 `REPLAY_UI_BINDING_NAME` 等价） */
  applyStudioUiCommand(ui: ReplayUiCommand): void {
    if (ui.kind === "segment_start") {
      this.emitSegmentStart(ui.note);
      return;
    }
    if (ui.kind === "segment_end") {
      this.emitSegmentEnd(ui.note);
      return;
    }
    if (ui.kind === "checkpoint") {
      this.emitAssertionCheckpoint(ui.note);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.uiCatchUpBuffer.length = 0;
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
    if (this.registerUiBinding) {
      try {
        await this.cdp.send("Runtime.removeBinding", { name: REPLAY_UI_BINDING_NAME }, this.flatSessionId);
      } catch {
        /* noop */
      }
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
  options?: StartPageRecordingOptions,
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
    const injectControls = options?.injectPageControls !== false;
    if (injectControls) {
      await cdp.send("Runtime.addBinding", { name: REPLAY_UI_BINDING_NAME }, flatSessionId);
    }

    const rec = new ActiveRecording(cdp, flatSessionId, injectControls);

    cdp.onProtocolEvent = (method, params, eventSessionId) => {
      if (method !== "Runtime.bindingCalled") return;
      if (eventSessionId !== undefined && eventSessionId !== flatSessionId) return;
      const p = params as { name?: string; payload?: string };
      if (p.name === BINDING_NAME) {
        rec.dispatchBindingPayload(p.payload ?? "");
        return;
      }
      if (p.name === REPLAY_UI_BINDING_NAME) {
        const ui = parseReplayUiCommand(p.payload ?? "");
        if (!ui) return;
        if (ui.kind === "segment_start") {
          rec.emitSegmentStart(ui.note);
          return;
        }
        if (ui.kind === "segment_end") {
          rec.emitSegmentEnd(ui.note);
          return;
        }
        if (ui.kind === "checkpoint") {
          rec.emitAssertionCheckpoint(ui.note);
        }
      }
    };

    const inject = buildInjectExpression(PAGE_MOVE_MIN_MS, SNAPSHOT_INTERVAL_MS, injectControls);
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

/**
 * 由 Studio（HTTP）投递 UI 标记，无需经页面 binding。
 */
export function emitPageRecordingStudioUiMarker(
  sessionId: string,
  targetId: string,
  ui: ReplayUiCommand,
): { ok: true } | { error: string; code: string } {
  const handle = recordings.get(recordingMapKey(sessionId, targetId));
  if (!handle) {
    return { error: "Recording is not active for this target", code: "RECORDER_NOT_ACTIVE" };
  }
  const applier = (handle as { applyStudioUiCommand?: (u: ReplayUiCommand) => void }).applyStudioUiCommand;
  if (typeof applier !== "function") {
    return { error: "Recorder does not support UI markers", code: "RECORDER_NO_UI" };
  }
  applier.call(handle, ui);
  return { ok: true };
}

/** 测试用：清空注册表并关闭连接 */
export function resetRecordingRegistryForTest(): void {
  for (const [, rec] of recordings) {
    void rec.close().catch(() => undefined);
  }
  recordings.clear();
}

function buildInjectExpression(moveMinMs: number, snapshotMs: number, injectControls: boolean): string {
  const move = Number(moveMinMs);
  const snap = Number(snapshotMs);
  const uiName = REPLAY_UI_BINDING_NAME;
  const controlBarInit = injectControls
    ? `
  var controlRoot = document.createElement("div");
  controlRoot.id = "__odReplayControlBar";
  controlRoot.setAttribute("data-opendesktop-replay-ui","control-bar");
  controlRoot.style.cssText = "position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:8px;align-items:center;padding:6px 10px;background:rgba(15,23,42,0.92);border-radius:8px;font:12px/1.2 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.25);";
  var uiSend = function(obj){ try { ${uiName}(JSON.stringify(obj)); } catch(eu){} };
  var odSegOpen = false;
  var btnSegStart = null;
  var btnSegEnd = null;
  var btnBaseStyle = "border:none;border-radius:6px;padding:4px 10px;background:#2563eb;color:#fff;transition:transform 0.15s ease,filter 0.15s ease,box-shadow 0.15s ease;";
  var flashBtn = function(b){
    b.style.transform = "scale(0.94)";
    b.style.filter = "brightness(1.18)";
    b.style.boxShadow = "0 0 0 2px rgba(147,197,253,0.95)";
    setTimeout(function(){
      b.style.transform = "";
      b.style.filter = "";
      b.style.boxShadow = "";
    }, 220);
  };
  var syncSegButtons = function(){
    if (!btnSegStart || !btnSegEnd) return;
    btnSegStart.disabled = odSegOpen;
    btnSegEnd.disabled = !odSegOpen;
    btnSegStart.style.opacity = odSegOpen ? "0.42" : "1";
    btnSegEnd.style.opacity = !odSegOpen ? "0.42" : "1";
    btnSegStart.style.cursor = odSegOpen ? "not-allowed" : "pointer";
    btnSegEnd.style.cursor = !odSegOpen ? "not-allowed" : "pointer";
  };
  btnSegStart = document.createElement("button");
  btnSegStart.type = "button";
  btnSegStart.textContent = "\\u6bb5\\u5f00\\u59cb";
  btnSegStart.style.cssText = "cursor:pointer;" + btnBaseStyle;
  btnSegStart.addEventListener("click", function(ev){
    ev.stopPropagation();
    if (odSegOpen) return;
    flashBtn(btnSegStart);
    uiSend({cmd:"segment_start"});
    odSegOpen = true;
    syncSegButtons();
  });
  btnSegEnd = document.createElement("button");
  btnSegEnd.type = "button";
  btnSegEnd.textContent = "\\u6bb5\\u7ed3\\u675f";
  btnSegEnd.style.cssText = "cursor:not-allowed;" + btnBaseStyle;
  btnSegEnd.addEventListener("click", function(ev){
    ev.stopPropagation();
    if (!odSegOpen) return;
    flashBtn(btnSegEnd);
    uiSend({cmd:"segment_end"});
    odSegOpen = false;
    syncSegButtons();
  });
  var btnCheckpoint = document.createElement("button");
  btnCheckpoint.type = "button";
  btnCheckpoint.textContent = "\\u68c0\\u67e5\\u70b9";
  btnCheckpoint.style.cssText = "cursor:pointer;" + btnBaseStyle;
  btnCheckpoint.addEventListener("click", function(ev){
    ev.stopPropagation();
    flashBtn(btnCheckpoint);
    uiSend({cmd:"checkpoint"});
  });
  controlRoot.appendChild(btnSegStart);
  controlRoot.appendChild(btnSegEnd);
  controlRoot.appendChild(btnCheckpoint);
  syncSegButtons();
  document.documentElement.appendChild(controlRoot);
`
    : `
  var controlRoot = null;
`;
  return `(function(){
  if (window.__odReplayV1) return "skip";
  window.__odReplayV1 = true;
  var MOVE_MIN = ${move};
  var SNAP_MS = ${snap};
  ${controlBarInit}
  var send = function(s){
    try { ${BINDING_NAME}(s); } catch (e) {}
  };
  var odFromControlBar = function(e){
    return !!(controlRoot && e && e.target && controlRoot.contains(e.target));
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
    if (odFromControlBar(e)) return;
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
    if (controlRoot && controlRoot.contains(el)) {
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
    if (odFromControlBar(e)) return;
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
    if (odFromControlBar(e)) return;
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
    try {
      if (controlRoot && controlRoot.parentNode) controlRoot.parentNode.removeChild(controlRoot);
    } catch (e1b) {}
    delete window.__odReplayCleanupV1;
    delete window.__odReplayV1;
  };
  return "ok";
})()`;
}

/**
 * 单元测试用：生成页面注入 IIFE 源码（含可选控制条）。
 */
export function testOnly_buildInjectExpression(
  moveMinMs: number,
  snapshotMs: number,
  injectControls: boolean,
): string {
  return buildInjectExpression(moveMinMs, snapshotMs, injectControls);
}
