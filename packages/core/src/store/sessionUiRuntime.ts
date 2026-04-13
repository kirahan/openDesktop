import type { SessionRecord } from "../session/types.js";
import type { JsonFileStore } from "./jsonStore.js";
import { normalizeUiRuntime, type UiRuntime } from "./types.js";

/**
 * 按 Profile → App 解析 `uiRuntime`，供 `GET /v1/sessions` 等接口填充。
 */
export async function enrichSessionsWithUiRuntime(
  store: JsonFileStore,
  sessions: SessionRecord[],
): Promise<SessionRecord[]> {
  const [{ profiles }, { apps }] = await Promise.all([store.readProfiles(), store.readApps()]);
  const appMap = new Map(apps.map((a) => [a.id, normalizeUiRuntime(a.uiRuntime)]));
  const profMap = new Map(profiles.map((p) => [p.id, p]));
  return sessions.map((s) => {
    const p = profMap.get(s.profileId);
    const uiRuntime: UiRuntime = p ? appMap.get(p.appId) ?? "electron" : "electron";
    return { ...s, uiRuntime };
  });
}
