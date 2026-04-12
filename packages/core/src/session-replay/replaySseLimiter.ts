/** 矢量录制 SSE 并发上限（与控制台 / 网络观测分表）。 */
export const MAX_CONCURRENT_REPLAY_SSE_STREAMS = 4;

let active = 0;

export function tryAcquireReplaySseStream(): boolean {
  if (active >= MAX_CONCURRENT_REPLAY_SSE_STREAMS) return false;
  active += 1;
  return true;
}

export function releaseReplaySseStream(): void {
  active = Math.max(0, active - 1);
}

/** 测试或诊断用 */
export function resetReplaySseCountForTest(): void {
  active = 0;
}
