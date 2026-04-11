/**
 * 注册应用前从 Core 拉取已有应用 id，用于 CLI 侧唯一性校验（GET /v1/apps）。
 */

export type AppListEntry = { id: string };

/** 解析 GET /v1/apps 响应中的 apps 数组 */
export function parseAppIdsFromListJson(raw: string): AppListEntry[] {
  let data: { apps?: AppListEntry[] };
  try {
    data = JSON.parse(raw) as { apps?: AppListEntry[] };
  } catch {
    return [];
  }
  const apps = data.apps;
  if (!Array.isArray(apps)) return [];
  return apps
    .filter((a): a is { id: string } => typeof a?.id === "string")
    .map((a) => ({ id: a.id }));
}

export function appIdExists(apps: AppListEntry[], id: string): boolean {
  return apps.some((a) => a.id === id);
}

/** 与产品文案一致：调用名已占用 */
export function formatAppIdConflictMessage(id: string): string {
  return `应用 id「${id}」已注册。请换一个调用名（须与 yarn oc <appId> 子命令中的名称一致且全局唯一）。`;
}
