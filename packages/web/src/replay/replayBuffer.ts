/** 与实时观测抽屉中矢量录制 tab 一致的最大行数 */
export const REPLAY_LOG_MAX_LINES = 500;

export function appendReplayLogLines(prev: string[], line: string): string[] {
  const next = [...prev, line];
  return next.length > REPLAY_LOG_MAX_LINES ? next.slice(-REPLAY_LOG_MAX_LINES) : next;
}
