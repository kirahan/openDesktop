/**
 * Web 注册表单：从可执行路径生成短应用 id 建议，并解析 GET /v1/apps 响应用于唯一性校验。
 */

const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 从可执行文件路径或文件名生成 URL 安全的 slug（去扩展名）。 */
export function slugFromExecutablePath(pathOrName: string): string {
  const trimmed = pathOrName.trim();
  if (!trimmed) return "app";
  const normalized = trimmed.replace(/\\/g, "/");
  const seg = normalized.split("/").pop() ?? normalized;
  const base = seg.replace(/^.*[/\\]/, "") || seg;
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "app";
}

/** 随机后缀，长度不超过 6，字符集为小写字母与数字。 */
export function randomAppIdSuffix(length = 6): string {
  const n = Math.min(6, Math.max(1, length));
  const out = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHANUM[out[i]! % 36];
  return s;
}

/** 短 slug 与短随机后缀拼接，作为默认应用 ID 建议值。 */
export function suggestedAppIdFromExecutablePath(pathOrName: string): string {
  return `${slugFromExecutablePath(pathOrName)}-${randomAppIdSuffix()}`;
}

/** GET /v1/apps 列表项（唯一性校验仅需 id）。 */
export type AppListEntry = { id: string };

/** 解析 GET /v1/apps 响应中的 apps 数组（仅保留 id 字段）。 */
export function parseAppIdsFromListJson(raw: string): AppListEntry[] {
  let data: { apps?: unknown[] };
  try {
    data = JSON.parse(raw) as { apps?: unknown[] };
  } catch {
    return [];
  }
  const apps = data.apps;
  if (!Array.isArray(apps)) return [];
  return apps
    .filter((a): a is { id: string } => typeof (a as { id?: unknown })?.id === "string")
    .map((a) => ({ id: (a as { id: string }).id }));
}

/** 判断应用 id 是否已出现在列表中。 */
export function appIdExists(apps: AppListEntry[], id: string): boolean {
  return apps.some((a) => a.id === id);
}
