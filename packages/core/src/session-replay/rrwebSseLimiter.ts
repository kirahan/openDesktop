/** rrweb 事件 SSE 并发上限（与矢量录制分表）。 */
export const MAX_CONCURRENT_RRWEB_SSE_STREAMS = 4;

let active = 0;

export function tryAcquireRrwebSseStream(): boolean {
  if (active >= MAX_CONCURRENT_RRWEB_SSE_STREAMS) return false;
  active += 1;
  return true;
}

export function releaseRrwebSseStream(): void {
  active = Math.max(0, active - 1);
}

export function resetRrwebSseCountForTest(): void {
  active = 0;
}
