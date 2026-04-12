import type { JsonFileStore } from "../store/jsonStore.js";
import type { SessionManager } from "../session/manager.js";

/**
 * 由会话解析 Profile 所属 `appId`；会话或 Profile 不存在时返回 undefined。
 */
export async function resolveAppIdForSession(
  store: JsonFileStore,
  manager: SessionManager,
  sessionId: string,
): Promise<string | undefined> {
  const rec = manager.get(sessionId);
  if (!rec) return undefined;
  const { profiles } = await store.readProfiles();
  const p = profiles.find((pr) => pr.id === rec.profileId);
  return p?.appId;
}
