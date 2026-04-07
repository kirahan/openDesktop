import WebSocket from "ws";

async function getBrowserWsUrl(cdpPort: number): Promise<string | undefined> {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  if (!res.ok) return undefined;
  const v = (await res.json()) as { webSocketDebuggerUrl?: string };
  return v.webSocketDebuggerUrl;
}

/**
 * 最小 CDP 多路复用客户端：连接 browser WebSocket，发送带可选 sessionId 的命令。
 */
class BrowserCdp {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  /** 非请求类协议事件（如 Runtime.consoleAPICalled） */
  onProtocolEvent?: (method: string, params: unknown) => void;

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data: WebSocket.RawData) => {
      let msg: {
        id?: number;
        method?: string;
        params?: unknown;
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
        if (msg.error) {
          p.reject(new Error(msg.error.message ?? "cdp_error"));
        } else {
          p.resolve(msg.result);
        }
        return;
      }
      if (msg.method && this.onProtocolEvent) {
        this.onProtocolEvent(msg.method, msg.params);
      }
    });
    ws.on("error", (err) => {
      for (const [, p] of this.pending) p.reject(err instanceof Error ? err : new Error(String(err)));
      this.pending.clear();
    });
  }

  close(): void {
    this.ws.close();
  }

  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload: Record<string, unknown> = { id, method, params: params ?? {} };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
}

export async function captureTargetScreenshot(
  cdpPort: number,
  targetId: string,
): Promise<{ base64: string; mime: string } | { error: string }> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const cdp = new BrowserCdp(ws);
  try {
    const attach = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId?: string };
    const sessionId = attach.sessionId;
    if (!sessionId) return { error: "attach_no_session" };

    await cdp.send("Page.enable", {}, sessionId);
    const shot = (await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)) as {
      data?: string;
    };
    if (!shot.data) return { error: "no_screenshot_data" };
    return { base64: shot.data, mime: "image/png" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cdp.close();
  }
}

export async function evaluateOnTarget(
  cdpPort: number,
  targetId: string,
  expression: string,
): Promise<{ result: unknown; type?: string } | { error: string }> {
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const cdp = new BrowserCdp(ws);
  try {
    const attach = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId?: string };
    const sessionId = attach.sessionId;
    if (!sessionId) return { error: "attach_no_session" };

    await cdp.send("Runtime.enable", {}, sessionId);
    const ev = (await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    )) as { result?: { value?: unknown; type?: string } };
    const r = ev.result;
    return { result: r?.value, type: r?.type };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cdp.close();
  }
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
  const wsUrl = await getBrowserWsUrl(cdpPort);
  if (!wsUrl) return { error: "no_browser_ws" };

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const cdp = new BrowserCdp(ws);
  try {
    const attach = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId?: string };
    const sessionId = attach.sessionId;
    if (!sessionId) return { error: "attach_no_session" };

    await cdp.send("DOM.enable", {}, sessionId);
    const doc = (await cdp.send("DOM.getDocument", { depth: 0, pierce: false }, sessionId)) as {
      root?: { nodeId: number };
    };
    if (!doc.root?.nodeId) return { error: "no_document_root" };

    const q = (await cdp.send(
      "DOM.querySelector",
      { nodeId: doc.root.nodeId, selector: "html" },
      sessionId,
    )) as { nodeId?: number };
    if (!q.nodeId) return { error: "no_html_element" };

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
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    cdp.close();
  }
}

export type ConsoleEntryPreview = {
  type: string;
  argsPreview: string[];
  timestamp?: number;
};

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
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

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
    const attach = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId?: string };
    const sessionId = attach.sessionId;
    if (!sessionId) return { error: "attach_no_session" };

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
