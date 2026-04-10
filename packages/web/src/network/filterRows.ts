import type { NetworkRequestRow } from "./types.js";

/**
 * 对 mock 列表做前端子串过滤（不区分大小写），匹配 method/host/url/type/status。
 */
export function filterNetworkRows(rows: NetworkRequestRow[], query: string): NetworkRequestRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const blob = [r.method, r.host, r.url, r.type, String(r.status), String(r.durationMs ?? ""), r.id]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}
