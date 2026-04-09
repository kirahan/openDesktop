import WebSocket from "ws";
import {
  parseExceptionDetailsFromThrown,
  type RuntimeStackFrame,
} from "./runtimeExceptionStack.js";

/** 与 OpenCLI CDP 发送超时的量级对齐；单条 CDP 命令默认上限。 */
export const DEFAULT_CDP_TIMEOUT_MS = 30_000;

/** 解析 browser CDP WebSocket URL（供流式观测等模块复用）。 */
export async function getBrowserWsUrl(cdpPort: number): Promise<string | undefined> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  if (!res.ok) return undefined;
  const v = (await res.json()) as { webSocketDebuggerUrl?: string };
  return v.webSocketDebuggerUrl;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ProtocolWaiter = {
  method: string;
  sessionId?: string;
  resolve: (params: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * 最小 CDP 多路复用客户端：连接 browser WebSocket，发送带可选 sessionId 的命令。
 */
export class BrowserCdp {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly protocolWaiters: ProtocolWaiter[] = [];
  /** 非请求类协议事件（如 Runtime.consoleAPICalled） */
  onProtocolEvent?: (method: string, params: unknown, sessionId?: string) => void;

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data: WebSocket.RawData) => {
      let msg: {
        id?: number;
        method?: string;
        params?: unknown;
        sessionId?: string;
        result?: unknown;
        error?: { message: string };
      };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          p.reject(new Error(msg.error.message ?? "cdp_error"));
        } else {
          p.resolve(msg.result);
        }
        return;
      }
      if (msg.method) {
        const sid = msg.sessionId;
        const idx = this.protocolWaiters.findIndex(
          (w) => w.method === msg.method && (!w.sessionId || w.sessionId === sid),
        );
        if (idx >= 0) {
          const w = this.protocolWaiters.splice(idx, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg.params);
          return;
        }
        if (this.onProtocolEvent) {
          this.onProtocolEvent(msg.method, msg.params ?? {}, sid);
        }
      }
    });

    const kill = (err: Error) => {
      this.rejectAll(err);
    };
    ws.on("error", (err) => {
      kill(err instanceof Error ? err : new Error(String(err)));
    });
    ws.on("close", () => {
      kill(new Error("cdp_ws_closed"));
    });
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    for (const w of this.protocolWaiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.protocolWaiters.length = 0;
  }

  close(): void {
    this.ws.close();
  }

  /**
   * @param timeoutMs 超时后 pending 移除并 reject（message: `cdp_timeout`）
   */
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("cdp_timeout"));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      });
      const payload: Record<string, unknown> = { id, method, params: params ?? {} };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  /**
   * 等待下一条匹配的 CDP 事件（无 `id` 的 protocol notification）。
   */
  waitForProtocolEvent(
    method: string,
    timeoutMs: number,
    sessionId?: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter: ProtocolWaiter = {
        method,
        sessionId,
        resolve: (params: unknown) => {
          clearTimeout(waiter.timer);
          const i = this.protocolWaiters.indexOf(waiter);
          if (i >= 0) this.protocolWaiters.splice(i, 1);
          resolve(params);
        },
        reject: (e: Error) => {
          clearTimeout(waiter.timer);
          const i = this.protocolWaiters.indexOf(waiter);
          if (i >= 0) this.protocolWaiters.splice(i, 1);
          reject(e);
        },
        timer: setTimeout(() => {
          const i = this.protocolWaiters.indexOf(waiter);
          if (i >= 0) this.protocolWaiters.splice(i, 1);
          reject(new Error("cdp_event_timeout"));
        }, timeoutMs),
      };
      this.protocolWaiters.push(waiter);
    });
  }
}

/**
 * 附着到调试 target 并返回 **扁平 sessionId**（flatten: true）。
 */
export async function attachToTargetSession(
  cdp: BrowserCdp,
  targetId: string,
  timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
): Promise<string> {
  const attach = (await cdp.send(
    "Target.attachToTarget",
    { targetId, flatten: true },
    undefined,
    timeoutMs,
  )) as { sessionId?: string };
  if (!attach.sessionId) throw new Error("attach_no_session");
  return attach.sessionId;
}

/** 连接 browser CDP WebSocket，执行 `fn` 后关闭连接。 */
export async function withBrowserCdp<T>(
  cdpPort: number,
  fn: (cdp: BrowserCdp) => Promise<T>,
): Promise<T | { error: string }> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const cdp = new BrowserCdp(ws);
  try {
    return await fn(cdp);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cdp.close();
  }
}

export async function captureTargetScreenshot(
  cdpPort: number,
  targetId: string,
): Promise<{ base64: string; mime: string } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Page.enable", {}, sessionId);
    const shot = (await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)) as {
      data?: string;
    };
    if (!shot.data) throw new Error("no_screenshot_data");
    return { base64: shot.data, mime: "image/png" };
  });
}

export async function evaluateOnTarget(
  cdpPort: number,
  targetId: string,
  expression: string,
): Promise<{ result: unknown; type?: string } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const ev = (await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    )) as { result?: { value?: unknown; type?: string } };
    const r = ev.result;
    return { result: r?.value, type: r?.type };
  });
}

const MAX_OUTER_HTML_CHARS = 1_500_000;

function previewConsoleArg(arg: {
  description?: string;
  value?: unknown;
  type?: string;
  preview?: { description?: string };
}): string {
  if (arg.description) return arg.description;
  if (arg.value !== undefined) {
    try {
      return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  if (arg.preview?.description) return arg.preview.description;
  return arg.type ?? "?";
}

/** 通过 DOM 域拉取 `<html>` 的 outerHTML，无需 Runtime.evaluate */
export async function getTargetDocumentOuterHtml(
  cdpPort: number,
  targetId: string,
): Promise<{ html: string; truncated: boolean } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("DOM.enable", {}, sessionId);
    const doc = (await cdp.send("DOM.getDocument", { depth: 0, pierce: false }, sessionId)) as {
      root?: { nodeId: number };
    };
    if (!doc.root?.nodeId) throw new Error("no_document_root");

    const q = (await cdp.send(
      "DOM.querySelector",
      { nodeId: doc.root.nodeId, selector: "html" },
      sessionId,
    )) as { nodeId?: number };
    if (!q.nodeId) throw new Error("no_html_element");

    const out = (await cdp.send("DOM.getOuterHTML", { nodeId: q.nodeId }, sessionId)) as {
      outerHTML?: string;
    };
    const raw = out.outerHTML ?? "";
    if (raw.length > MAX_OUTER_HTML_CHARS) {
      return {
        html: `${raw.slice(0, MAX_OUTER_HTML_CHARS)}\n<!-- opendesktop: truncated -->`,
        truncated: true,
      };
    }
    return { html: raw, truncated: false };
  });
}

export type ConsoleEntryPreview = {
  type: string;
  argsPreview: string[];
  timestamp?: number;
};

export type { RuntimeStackFrame };

/**
 * 短时订阅 `Runtime.exceptionThrown`，返回窗口内**首条**未捕获异常的结构化栈（与 {@link collectConsoleMessagesForTarget} 相同的等待模型）。
 */
export async function collectRuntimeExceptionForTarget(
  cdpPort: number,
  targetId: string,
  waitMs: number,
): Promise<
  | {
      text: string;
      textTruncated: boolean;
      frames: RuntimeStackFrame[];
      note: string;
    }
  | { error: string }
> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const cdp = new BrowserCdp(ws);
  let flatSessionId: string | undefined;
  let captured:
    | { text: string; textTruncated: boolean; frames: RuntimeStackFrame[] }
    | undefined;

  cdp.onProtocolEvent = (method, params, eventSessionId) => {
    if (method !== "Runtime.exceptionThrown") return;
    if (flatSessionId !== undefined && eventSessionId !== undefined && eventSessionId !== flatSessionId) {
      return;
    }
    if (captured) return;
    captured = parseExceptionDetailsFromThrown(params);
  };

  try {
    flatSessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, flatSessionId);
    const ms = Math.min(Math.max(waitMs, 100), 30_000);
    await new Promise((r) => setTimeout(r, ms));

    const base = captured ?? { text: "", textTruncated: false, frames: [] };
    const note = captured
      ? "仅包含监听窗口内首条 uncaught exception 的栈（CDP 投递顺序为准，无历史回溯）。"
      : "等待窗口内未收到新的 uncaught exception；frames 为空表示该时段内无此类事件（不表示页面从未报错）。";
    return { ...base, note };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cdp.close();
  }
}

/**
 * 在短时窗口内监听 Runtime.consoleAPICalled。CDP 无法回溯历史控制台消息，仅能收到连接建立之后产生的日志。
 */
export async function collectConsoleMessagesForTarget(
  cdpPort: number,
  targetId: string,
  waitMs: number,
): Promise<{ entries: ConsoleEntryPreview[]; note: string } | { error: string }> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const entries: ConsoleEntryPreview[] = [];
  const cdp = new BrowserCdp(ws);
  cdp.onProtocolEvent = (method, params) => {
    if (method !== "Runtime.consoleAPICalled") return;
    const p = params as {
      type?: string;
      args?: Array<{
        description?: string;
        value?: unknown;
        type?: string;
        preview?: { description?: string };
      }>;
      timestamp?: number;
    };
    entries.push({
      type: p.type ?? "log",
      argsPreview: (p.args ?? []).map(previewConsoleArg),
      timestamp: p.timestamp,
    });
  };

  try {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const ms = Math.min(Math.max(waitMs, 100), 30_000);
    await new Promise((r) => setTimeout(r, ms));

    const note =
      "仅包含上述等待窗口内新产生的控制台输出（CDP 无法读取历史消息）；需要更多日志时可拉长等待并在页面内触发输出。";
    return { entries, note };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cdp.close();
  }
}

/**
 * 持续监听 `Runtime.consoleAPICalled`，直到 `signal` abort（客户端断开）或 CDP 错误。
 * 不读取历史控制台；与 {@link collectConsoleMessagesForTarget} 相同预览格式。
 */
export async function runConsoleMessageStream(
  cdpPort: number,
  targetId: string,
  onEntry: (entry: ConsoleEntryPreview) => void,
  signal: AbortSignal,
): Promise<{ error?: string }> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  const closeWs = (): void => {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };

  const abortPromise = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const cdp = new BrowserCdp(ws);
  let flatSessionId: string | undefined;

  cdp.onProtocolEvent = (method, params, eventSessionId) => {
    if (method !== "Runtime.consoleAPICalled") return;
    if (flatSessionId !== undefined && eventSessionId !== undefined && eventSessionId !== flatSessionId) {
      return;
    }
    const p = params as {
      type?: string;
      args?: Array<{
        description?: string;
        value?: unknown;
        type?: string;
        preview?: { description?: string };
      }>;
      timestamp?: number;
    };
    onEntry({
      type: p.type ?? "log",
      argsPreview: (p.args ?? []).map(previewConsoleArg),
      timestamp: p.timestamp,
    });
  };

  try {
    flatSessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, flatSessionId);
    await abortPromise;
    return {};
  } catch (e) {
    if (signal.aborted) return {};
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    closeWs();
  }
}

/** 导航到 URL 并等待 `Page.loadEventFired`。 */
export async function openTargetUrl(
  cdpPort: number,
  targetId: string,
  url: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Page.enable", {}, sessionId);
    const loadPromise = cdp.waitForProtocolEvent(
      "Page.loadEventFired",
      DEFAULT_CDP_TIMEOUT_MS,
      sessionId,
    );
    await cdp.send("Page.navigate", { url }, sessionId);
    await loadPromise;
    return { ok: true as const };
  });
}

/** `Network.enable` + `Network.getCookies`（只读）。 */
export async function getNetworkCookiesForTarget(
  cdpPort: number,
  targetId: string,
  urls?: string[],
): Promise<{ cookies: unknown[] } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Network.enable", {}, sessionId);
    const res = (await cdp.send(
      "Network.getCookies",
      urls?.length ? { urls } : {},
      sessionId,
    )) as { cookies?: unknown[] };
    return { cookies: res.cookies ?? [] };
  });
}

function evalValue(
  cdp: BrowserCdp,
  sessionId: string,
  expression: string,
): Promise<unknown> {
  return cdp
    .send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    )
    .then((raw) => {
      const ev = raw as { result?: { value?: unknown } };
      return ev.result?.value;
    });
}

/** 在元素中心近似点击（需脚本能力以解析 selector）。 */
export async function clickOnTarget(
  cdpPort: number,
  targetId: string,
  selector: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const expr = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;
    const pos = await evalValue(cdp, sessionId, expr) as { x: number; y: number } | null;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
      throw new Error("click_no_element");
    }
    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x: pos.x,
        y: pos.y,
        button: "left",
        clickCount: 1,
      },
      sessionId,
    );
    await cdp.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: pos.x,
        y: pos.y,
        button: "left",
        clickCount: 1,
      },
      sessionId,
    );
    return { ok: true as const };
  });
}

/** 聚焦元素并 `Input.insertText`。 */
export async function typeOnTarget(
  cdpPort: number,
  targetId: string,
  selector: string,
  text: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const focused = (await evalValue(
      cdp,
      sessionId,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`,
    )) as boolean;
    if (!focused) throw new Error("type_no_element");
    await cdp.send("Input.insertText", { text }, sessionId);
    return { ok: true as const };
  });
}

export async function scrollOnTarget(
  cdpPort: number,
  targetId: string,
  opts: { selector?: string; deltaX?: number; deltaY?: number },
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    if (opts.selector) {
      await evalValue(
        cdp,
        sessionId,
        `document.querySelector(${JSON.stringify(opts.selector)})?.scrollIntoView({ block: 'center' })`,
      );
    } else {
      const dx = opts.deltaX ?? 0;
      const dy = opts.deltaY ?? 0;
      await evalValue(cdp, sessionId, `window.scrollBy(${dx}, ${dy})`);
    }
    return { ok: true as const };
  });
}

const KEY_DEF: Record<string, { key: string; code: string; vk?: number }> = {
  Enter: { key: "Enter", code: "Enter", vk: 13 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
};

/** 派发一次按键（keyDown + keyUp），`key` 可为常见名或单字符。 */
export async function keysOnTarget(
  cdpPort: number,
  targetId: string,
  key: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const def = KEY_DEF[key] ??
      (key.length === 1 ? { key, code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0) } : undefined);
    if (!def) throw new Error("keys_unknown");

    const down: Record<string, unknown> = {
      type: "keyDown",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    };
    const up = { ...down, type: "keyUp" };
    await cdp.send("Input.dispatchKeyEvent", down, sessionId);
    await cdp.send("Input.dispatchKeyEvent", up, sessionId);
    return { ok: true as const };
  });
}

export async function selectOnTarget(
  cdpPort: number,
  targetId: string,
  selector: string,
  value: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const ok = (await evalValue(
      cdp,
      sessionId,
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || el.tagName !== 'SELECT') return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
    )) as boolean;
    if (!ok) throw new Error("select_failed");
    return { ok: true as const };
  });
}

export async function waitOnTarget(
  cdpPort: number,
  targetId: string,
  opts: { ms?: number; selector?: string; timeoutMs?: number },
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    const capMs = 60_000;
    if (typeof opts.ms === "number" && opts.ms > 0) {
      await new Promise((r) => setTimeout(r, Math.min(opts.ms!, capMs)));
    }
    if (opts.selector) {
      await cdp.send("Runtime.enable", {}, sessionId);
      const deadline = Date.now() + Math.min(opts.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS, capMs);
      const selExpr = `!!document.querySelector(${JSON.stringify(opts.selector)})`;
      while (Date.now() < deadline) {
        const hit = (await evalValue(cdp, sessionId, selExpr)) as boolean;
        if (hit) return { ok: true as const };
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("wait_timeout");
    }
    return { ok: true as const };
  });
}

export async function navigateBackOnTarget(
  cdpPort: number,
  targetId: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Page.enable", {}, sessionId);
    const hist = (await cdp.send("Page.getNavigationHistory", {}, sessionId)) as {
      currentIndex?: number;
      entries?: Array<{ id: number }>;
    };
    const idx = hist.currentIndex;
    const entries = hist.entries;
    if (idx === undefined || !entries || idx <= 0) throw new Error("no_history_back");
    const entryId = entries[idx - 1]?.id;
    if (entryId === undefined) throw new Error("no_history_back");
    const loadPromise = cdp.waitForProtocolEvent(
      "Page.loadEventFired",
      DEFAULT_CDP_TIMEOUT_MS,
      sessionId,
    );
    await cdp.send("Page.navigateToHistoryEntry", { entryId }, sessionId);
    await loadPromise;
    return { ok: true as const };
  });
}

export async function closeTarget(
  cdpPort: number,
  targetId: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    await cdp.send("Target.closeTarget", { targetId });
    return { ok: true as const };
  });
}

/** Browser.getWindowForTarget 归一化结果 */
export type TargetWindowStatePayload = {
  bounds: { left: number; top: number; width: number; height: number };
  /** Chromium：`normal` | `minimized` | `maximized` | `fullscreen` */
  windowState?: string;
  pageVisibility?: string;
  pageHasFocus?: boolean;
  /** 未开启脚本权限时说明为何缺少页面级字段 */
  pageMetricsNote?: string;
};

/**
 * 查询 target 所在宿主窗口的几何与状态；可选附带 `document.visibilityState` / `document.hasFocus()`（需 `includePageMetrics`）。
 */
export async function getTargetWindowState(
  cdpPort: number,
  targetId: string,
  opts?: { includePageMetrics?: boolean },
): Promise<TargetWindowStatePayload | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const win = (await cdp.send("Browser.getWindowForTarget", { targetId })) as {
      bounds?: { left: number; top: number; width: number; height: number; windowState?: string };
      windowState?: string;
    };
    const b = win.bounds ?? { left: 0, top: 0, width: 0, height: 0 };
    const bounds = {
      left: b.left ?? 0,
      top: b.top ?? 0,
      width: b.width ?? 0,
      height: b.height ?? 0,
    };
    const windowState = win.windowState ?? b.windowState;
    const out: TargetWindowStatePayload = {
      bounds,
      windowState,
    };
    if (opts?.includePageMetrics) {
      const sessionId = await attachToTargetSession(cdp, targetId);
      await cdp.send("Runtime.enable", {}, sessionId);
      const ev = (await cdp.send(
        "Runtime.evaluate",
        {
          expression:
            "({ visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a', hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false })",
          returnByValue: true,
        },
        sessionId,
      )) as { result?: { value?: { visibility?: string; hasFocus?: boolean } } };
      const v = ev.result?.value;
      if (v) {
        out.pageVisibility = v.visibility;
        out.pageHasFocus = v.hasFocus;
      }
    } else {
      out.pageMetricsNote =
        "未请求页面级可见性/焦点（会话未开启 allowScriptExecution 时仅返回 Browser 窗口域）。";
    }
    return out;
  });
}

/** CDP Page.bringToFront：将页面提到前台（Electron/Chromium 下通常等价于激活窗口栈）。 */
export async function bringTargetPageToFront(
  cdpPort: number,
  targetId: string,
): Promise<{ ok: true } | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Page.bringToFront", {}, sessionId);
    return { ok: true as const };
  });
}
