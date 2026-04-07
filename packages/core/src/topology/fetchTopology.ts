import { buildTopologySnapshot } from "./normalize.js";
import type { TopologySnapshot } from "./types.js";

export async function fetchJsonList(cdpHttpOrigin: string): Promise<{ ok: true; data: unknown[] } | { ok: false; error: string }> {
  const url = `${cdpHttpOrigin.replace(/\/$/, "")}/json/list`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return { ok: false, error: "invalid_json_list" };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function collectTopologySnapshot(sessionId: string, cdpPort: number): Promise<TopologySnapshot> {
  const origin = `http://127.0.0.1:${cdpPort}`;
  const fetched = await fetchJsonList(origin);
  if (!fetched.ok) {
    return buildTopologySnapshot(sessionId, [], [fetched.error]);
  }
  return buildTopologySnapshot(sessionId, fetched.data, []);
}
