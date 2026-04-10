import type { LocalProxyRule } from "./localProxyTypes.js";

/**
 * 按 host 后缀与 path 前缀匹配规则，合并 tags。
 * CONNECT（无 path）时 path 传空串，仅匹配未限定 pathPrefix 或 pathPrefix 为空的规则。
 */
export function matchProxyRules(host: string, pathname: string, rules: LocalProxyRule[]): string[] {
  const tags: string[] = [];
  const h = host.toLowerCase();
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  for (const r of rules) {
    if (r.hostSuffix) {
      const suf = r.hostSuffix.toLowerCase();
      if (!h.endsWith(suf) && h !== r.hostSuffix.toLowerCase()) continue;
    }
    if (r.pathPrefix !== undefined && r.pathPrefix !== "") {
      const pref = r.pathPrefix.startsWith("/") ? r.pathPrefix : `/${r.pathPrefix}`;
      if (!p.startsWith(pref)) continue;
    }
    if (r.tags?.length) tags.push(...r.tags);
  }
  return tags;
}
