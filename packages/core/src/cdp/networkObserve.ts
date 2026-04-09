import type { BrowserCdp } from "./browserClient.js";
import { attachToTargetSession, withBrowserCdp } from "./browserClient.js";

/** 与 HTTP 响应 JSON 对齐的 schema 版本。 */
export const NETWORK_OBSERVE_SCHEMA_VERSION = 1 as const;

/** 观测窗口毫秒：下限（含）。 */
export const NETWORK_OBSERVE_WINDOW_MS_MIN = 100;
/** 观测窗口毫秒：上限（含）。 */
export const NETWORK_OBSERVE_WINDOW_MS_MAX = 30_000;
/** 默认观测窗口。 */
export const DEFAULT_NETWORK_OBSERVE_WINDOW_MS = 3000;
/** 慢请求默认阈值（毫秒）。 */
export const DEFAULT_SLOW_THRESHOLD_MS = 1000;
/** 慢请求条数上限。 */
export const MAX_SLOW_REQUEST_ENTRIES = 20;
/** 最多跟踪的 requestId 条数（防 OOM）；超出后丢弃新请求并 `truncated: true`。 */
export const MAX_TRACKED_REQUESTS = 5000;
/** 单条 URL 最大字符数。 */
export const MAX_URL_DISPLAY_LENGTH = 2048;

export type NetworkObserveOptions = {
  windowMs: number;
  slowThresholdMs: number;
  maxSlowRequests: number;
  stripQuery: boolean;
};

export type NetworkObserveSlowEntry = {
  method: string;
  url: string;
  status?: number;
  durationMs: number;
};

/**
 * `network-observe` 动作成功时的 JSON 形状（`schemaVersion: 1`）。
 */
export type NetworkObserveResult = {
  schemaVersion: typeof NETWORK_OBSERVE_SCHEMA_VERSION;
  /** 观测窗口配置（毫秒） */
  windowMs: number;
  /** `Network.requestWillBeSent` 被接受并进入跟踪的数量（受 `MAX_TRACKED_REQUESTS` 限制） */
  totalRequests: number;
  /** 在窗口内收到 `loadingFinished` / `loadingFailed` 的请求数（有耗时或可计失败） */
  completedRequests: number;
  /** 窗口内任意时刻未结束请求数的最大值 */
  maxConcurrent: number;
  /** 耗时 ≥ `slowThresholdMs` 的已完成请求，按耗时降序，最多 `maxSlowRequests` 条 */
  slowRequests: NetworkObserveSlowEntry[];
  /** 是否因跟踪上限丢弃了部分 `requestWillBeSent` */
  truncated: boolean;
  /** 窗口结束时仍在进行中的请求数（无法给出总耗时） */
  inflightAtEnd: number;
  slowThresholdMs: number;
  stripQuery: boolean;
};

type Pending = {
  method: string;
  url: string;
  startTs: number;
  status?: number;
};

/** 内部累加器（单测与 CDP 共用）。 */
export type NetworkObserveAccumulator = {
  truncated: boolean;
  inflight: number;
  maxConcurrent: number;
  /** 已接受的 willBeSent 数 */
  initiated: number;
  pending: Map<string, Pending>;
  completed: Array<{
    requestId: string;
    method: string;
    url: string;
    status?: number;
    durationMs: number;
  }>;
};

export function createNetworkObserveAccumulator(): NetworkObserveAccumulator {
  return {
    truncated: false,
    inflight: 0,
    maxConcurrent: 0,
    initiated: 0,
    pending: new Map(),
    completed: [],
  };
}

/**
 * 裁剪展示用 URL：可选去掉 query/hash，并限制长度。
 */
export function formatUrlForObserve(rawUrl: string, stripQuery: boolean, maxLen: number): string {
  let u = rawUrl;
  if (stripQuery) {
    try {
      const p = new URL(rawUrl);
      p.search = "";
      p.hash = "";
      u = p.toString();
    } catch {
      const q = rawUrl.indexOf("?");
      const h = rawUrl.indexOf("#");
      const cut = q >= 0 ? q : h >= 0 ? h : rawUrl.length;
      u = rawUrl.slice(0, cut);
    }
  }
  if (u.length > maxLen) return `${u.slice(0, maxLen)}…`;
  return u;
}

export function clampWindowMs(ms: unknown): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_NETWORK_OBSERVE_WINDOW_MS;
  const w = Math.floor(ms);
  return Math.min(NETWORK_OBSERVE_WINDOW_MS_MAX, Math.max(NETWORK_OBSERVE_WINDOW_MS_MIN, w));
}

export function clampSlowThresholdMs(ms: unknown): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return DEFAULT_SLOW_THRESHOLD_MS;
  const w = Math.floor(ms);
  return Math.min(600_000, Math.max(0, w));
}

export function clampMaxSlowRequests(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return MAX_SLOW_REQUEST_ENTRIES;
  const w = Math.floor(n);
  return Math.min(100, Math.max(1, w));
}

function parseTimestamp(params: Record<string, unknown>): number | undefined {
  const t = params.timestamp;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  return undefined;
}

/**
 * 处理 CDP `Network.requestWillBeSent` 的 `params`。
 */
export function applyRequestWillBeSent(
  acc: NetworkObserveAccumulator,
  params: Record<string, unknown>,
  opts: { stripQuery: boolean; maxTracked: number },
): void {
  const requestId = params.requestId;
  if (typeof requestId !== "string" || !requestId) return;
  const req = params.request as { url?: string; method?: string } | undefined;
  const urlRaw = req?.url;
  const method = typeof req?.method === "string" ? req.method : "GET";
  if (typeof urlRaw !== "string" || !urlRaw) return;

  if (acc.initiated >= opts.maxTracked) {
    acc.truncated = true;
    return;
  }
  acc.initiated++;
  const url = formatUrlForObserve(urlRaw, opts.stripQuery, MAX_URL_DISPLAY_LENGTH);
  const ts = parseTimestamp(params) ?? 0;
  acc.pending.set(requestId, { method, url, startTs: ts });
  acc.inflight++;
  acc.maxConcurrent = Math.max(acc.maxConcurrent, acc.inflight);
}

export function applyResponseReceived(acc: NetworkObserveAccumulator, params: Record<string, unknown>): void {
  const requestId = params.requestId;
  if (typeof requestId !== "string" || !requestId) return;
  const pending = acc.pending.get(requestId);
  if (!pending) return;
  const response = params.response as { status?: number } | undefined;
  const st = response?.status;
  if (typeof st === "number" && Number.isFinite(st)) pending.status = st;
}

export function applyLoadingFinished(acc: NetworkObserveAccumulator, params: Record<string, unknown>): void {
  const requestId = params.requestId;
  if (typeof requestId !== "string" || !requestId) return;
  const pending = acc.pending.get(requestId);
  if (!pending) return;
  const endTs = parseTimestamp(params);
  acc.pending.delete(requestId);
  acc.inflight = Math.max(0, acc.inflight - 1);
  const startTs = pending.startTs;
  const end = endTs ?? startTs;
  const durationMs = Math.max(0, (end - startTs) * 1000);
  acc.completed.push({
    requestId,
    method: pending.method,
    url: pending.url,
    status: pending.status,
    durationMs,
  });
}

export function applyLoadingFailed(acc: NetworkObserveAccumulator, params: Record<string, unknown>): void {
  const requestId = params.requestId;
  if (typeof requestId !== "string" || !requestId) return;
  const pending = acc.pending.get(requestId);
  if (!pending) return;
  const endTs = parseTimestamp(params);
  acc.pending.delete(requestId);
  acc.inflight = Math.max(0, acc.inflight - 1);
  const startTs = pending.startTs;
  const end = endTs ?? startTs;
  const durationMs = Math.max(0, (end - startTs) * 1000);
  acc.completed.push({
    requestId,
    method: pending.method,
    url: pending.url,
    status: pending.status,
    durationMs,
  });
}

export function finalizeNetworkObserveResult(
  acc: NetworkObserveAccumulator,
  opts: NetworkObserveOptions,
): NetworkObserveResult {
  const slowThresholdMs = opts.slowThresholdMs;
  const maxSlow = opts.maxSlowRequests;
  const slowCandidates = acc.completed
    .filter((c) => c.durationMs >= slowThresholdMs)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, maxSlow)
    .map((c) => ({
      method: c.method,
      url: c.url,
      status: c.status,
      durationMs: c.durationMs,
    }));

  return {
    schemaVersion: NETWORK_OBSERVE_SCHEMA_VERSION,
    windowMs: opts.windowMs,
    totalRequests: acc.initiated,
    completedRequests: acc.completed.length,
    maxConcurrent: acc.maxConcurrent,
    slowRequests: slowCandidates,
    truncated: acc.truncated,
    inflightAtEnd: acc.inflight,
    slowThresholdMs,
    stripQuery: opts.stripQuery,
  };
}

/**
 * 在给定时间窗口内对 target 启用 `Network` 域并聚合 HTTP(S) 请求元数据（不含 body）。
 */
export async function collectNetworkObservationForTarget(
  cdpPort: number,
  targetId: string,
  options: NetworkObserveOptions,
): Promise<NetworkObserveResult | { error: string }> {
  return withBrowserCdp(cdpPort, async (cdp: BrowserCdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Network.enable", {}, sessionId);
    const acc = createNetworkObserveAccumulator();
    const stripQuery = options.stripQuery;
    const maxTracked = MAX_TRACKED_REQUESTS;

    cdp.onProtocolEvent = (method: string, params: unknown, sid?: string) => {
      if (sid !== undefined && sid !== sessionId) return;
      const p = params as Record<string, unknown>;
      switch (method) {
        case "Network.requestWillBeSent":
          applyRequestWillBeSent(acc, p, { stripQuery, maxTracked });
          break;
        case "Network.responseReceived":
          applyResponseReceived(acc, p);
          break;
        case "Network.loadingFinished":
          applyLoadingFinished(acc, p);
          break;
        case "Network.loadingFailed":
          applyLoadingFailed(acc, p);
          break;
        default:
          break;
      }
    };

    const ms = Math.min(
      NETWORK_OBSERVE_WINDOW_MS_MAX,
      Math.max(NETWORK_OBSERVE_WINDOW_MS_MIN, Math.floor(options.windowMs)),
    );
    await new Promise<void>((r) => setTimeout(r, ms));
    return finalizeNetworkObserveResult(acc, { ...options, windowMs: ms });
  });
}
