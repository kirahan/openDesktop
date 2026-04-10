import type { NetworkRequestRow } from "./types.js";

/** Core SSE `requestComplete` 负载（与 packages/core networkObserveStream 对齐） */
export type NetworkSseRequestComplete = {
  kind?: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
};

function guessType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".js") || lower.includes(".mjs")) return "script";
  if (lower.includes(".css")) return "stylesheet";
  if (lower.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/)) return "image";
  if (lower.includes("font") || lower.match(/\.(woff2?|ttf|otf)(\?|$)/)) return "font";
  return "other";
}

/**
 * 将 SSE `requestComplete` 事件转为表格行（host/url 从绝对 URL 解析）。
 */
export function requestCompleteToRow(o: NetworkSseRequestComplete): NetworkRequestRow {
  const rawUrl = o.url ?? "";
  const id = o.requestId?.trim() || `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let host = "—";
  let pathPart = rawUrl;
  try {
    const u = new URL(rawUrl);
    host = u.host || "—";
    pathPart = `${u.pathname}${u.search}`;
  } catch {
    /* 非标准 URL 时整段放在 url 列 */
  }
  return {
    id,
    status: typeof o.status === "number" && Number.isFinite(o.status) ? o.status : 0,
    method: (o.method ?? "GET").toUpperCase(),
    host,
    url: pathPart || rawUrl,
    type: guessType(rawUrl),
    durationMs:
      typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? o.durationMs : undefined,
  };
}
