import type { SessionState } from "../session/types.js";

export interface SessionRow {
  id: string;
  profileId: string;
  state: SessionState;
  createdAt: string;
}

export interface ProfileRow {
  id: string;
  appId: string;
}

/** 与 Web「活跃会话」筛选一致：可用于 CDP/观测 */
const ACTIVE_STATES: ReadonlySet<SessionState> = new Set(["running", "starting", "pending"]);

/**
 * 选取某应用下「最新」的活跃会话（按 createdAt ISO 降序）。
 * 若无候选返回 null。
 */
export function pickLatestActiveSessionForApp(
  sessions: SessionRow[],
  profiles: ProfileRow[],
  appId: string,
): SessionRow | null {
  const profileIdsForApp = new Set(profiles.filter((p) => p.appId === appId).map((p) => p.id));
  if (profileIdsForApp.size === 0) return null;

  const candidates = sessions.filter((s) => profileIdsForApp.has(s.profileId) && ACTIVE_STATES.has(s.state));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return candidates[0] ?? null;
}
