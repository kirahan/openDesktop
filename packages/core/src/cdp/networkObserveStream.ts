import WebSocket from "ws";
import { BrowserCdp, attachToTargetSession, getBrowserWsUrl } from "./browserClient.js";
import {
  formatUrlForObserve,
  MAX_TRACKED_REQUESTS,
  MAX_URL_DISPLAY_LENGTH,
} from "./networkObserve.js";

/** 默认每秒最多向 SSE 客户端推送的「请求完成」条数（超出则丢弃并累计）。 */
export const NETWORK_SSE_MAX_EVENTS_PER_SECOND = 40;

export type NetworkSseRequestCompleteEvent = {
  kind: "requestComplete";
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  requestId: string;
};

type Pending = {
  method: string;
  url: string;
  startTs: number;
  status?: number;
};

function parseTimestamp(params: Record<string, unknown>): number | undefined {
  const t = params.timestamp;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  return undefined;
}

/**
 * 每秒窗口速率限制：返回 true 表示允许本帧发出，false 表示应丢弃并计入背压。
 */
export function allowNetworkSseEmitPerSecond(
  state: { secondEpoch: number; countInSecond: number },
  maxPerSecond: number,
): { allowed: boolean; state: { secondEpoch: number; countInSecond: number } } {
  const epoch = Math.floor(Date.now() / 1000);
  let countInSecond = state.countInSecond;
  if (epoch !== state.secondEpoch) {
    return { allowed: true, state: { secondEpoch: epoch, countInSecond: 1 } };
  }
  if (countInSecond >= maxPerSecond) {
    return { allowed: false, state: { secondEpoch: epoch, countInSecond } };
  }
  return { allowed: true, state: { secondEpoch: epoch, countInSecond: countInSecond + 1 } };
}

/**
 * 持续订阅 CDP Network，在每条请求完成（loadingFinished / loadingFailed）时推送元数据，直到 `signal` abort。
 * 不采集 body；URL 展示与 `network-observe` 的 strip 策略一致。
 */
export async function runNetworkObservationStream(
  cdpPort: number,
  targetId: string,
  opts: {
    stripQuery: boolean;
    maxEventsPerSecond: number;
    onRequestComplete: (ev: NetworkSseRequestCompleteEvent) => void;
    onDropped: (delta: number) => void;
  },
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
  const pending = new Map<string, Pending>();
  let initiated = 0;
  const stripQuery = opts.stripQuery;
  let rateState = { secondEpoch: 0, countInSecond: 0 };

  const emitComplete = (requestId: string, pendingRow: Pending, endTs: number | undefined): void => {
    const startTs = pendingRow.startTs;
    const end = endTs ?? startTs;
    const durationMs = Math.max(0, (end - startTs) * 1000);
    const ev: NetworkSseRequestCompleteEvent = {
      kind: "requestComplete",
      requestId,
      method: pendingRow.method,
      url: pendingRow.url,
      status: pendingRow.status,
      durationMs,
    };
    const { allowed, state } = allowNetworkSseEmitPerSecond(rateState, opts.maxEventsPerSecond);
    rateState = state;
    if (!allowed) {
      opts.onDropped(1);
      return;
    }
    opts.onRequestComplete(ev);
  };

  cdp.onProtocolEvent = (method: string, params: unknown, eventSessionId?: string) => {
    if (flatSessionId !== undefined && eventSessionId !== undefined && eventSessionId !== flatSessionId) {
      return;
    }
    const p = params as Record<string, unknown>;
    switch (method) {
      case "Network.requestWillBeSent": {
        const requestId = p.requestId;
        if (typeof requestId !== "string" || !requestId) return;
        const req = p.request as { url?: string; method?: string } | undefined;
        const urlRaw = req?.url;
        const method = typeof req?.method === "string" ? req.method : "GET";
        if (typeof urlRaw !== "string" || !urlRaw) return;
        if (initiated >= MAX_TRACKED_REQUESTS) {
          return;
        }
        initiated++;
        const url = formatUrlForObserve(urlRaw, stripQuery, MAX_URL_DISPLAY_LENGTH);
        const ts = parseTimestamp(p) ?? 0;
        pending.set(requestId, { method, url, startTs: ts });
        break;
      }
      case "Network.responseReceived": {
        const requestId = p.requestId;
        if (typeof requestId !== "string" || !requestId) return;
        const row = pending.get(requestId);
        if (!row) return;
        const response = p.response as { status?: number } | undefined;
        const st = response?.status;
        if (typeof st === "number" && Number.isFinite(st)) row.status = st;
        break;
      }
      case "Network.loadingFinished": {
        const requestId = p.requestId;
        if (typeof requestId !== "string" || !requestId) return;
        const row = pending.get(requestId);
        if (!row) return;
        pending.delete(requestId);
        emitComplete(requestId, row, parseTimestamp(p));
        break;
      }
      case "Network.loadingFailed": {
        const requestId = p.requestId;
        if (typeof requestId !== "string" || !requestId) return;
        const row = pending.get(requestId);
        if (!row) return;
        pending.delete(requestId);
        emitComplete(requestId, row, parseTimestamp(p));
        break;
      }
      default:
        break;
    }
  };

  try {
    flatSessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Network.enable", {}, flatSessionId);
    await abortPromise;
    return {};
  } catch (e) {
    if (signal.aborted) return {};
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    closeWs();
  }
}
