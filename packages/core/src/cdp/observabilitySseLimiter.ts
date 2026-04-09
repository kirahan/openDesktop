/** 网络观测 SSE 并发上限（与控制台流分表，避免挤占 console 名额）。 */
export const MAX_CONCURRENT_NETWORK_SSE_STREAMS = 4;
/** 运行时异常栈 SSE 并发上限。 */
export const MAX_CONCURRENT_RUNTIME_EXCEPTION_SSE_STREAMS = 4;

let activeNetworkSse = 0;
let activeRuntimeExceptionSse = 0;

export function tryAcquireNetworkSseStream(): boolean {
  if (activeNetworkSse >= MAX_CONCURRENT_NETWORK_SSE_STREAMS) return false;
  activeNetworkSse += 1;
  return true;
}

export function releaseNetworkSseStream(): void {
  activeNetworkSse = Math.max(0, activeNetworkSse - 1);
}

export function tryAcquireRuntimeExceptionSseStream(): boolean {
  if (activeRuntimeExceptionSse >= MAX_CONCURRENT_RUNTIME_EXCEPTION_SSE_STREAMS) return false;
  activeRuntimeExceptionSse += 1;
  return true;
}

export function releaseRuntimeExceptionSseStream(): void {
  activeRuntimeExceptionSse = Math.max(0, activeRuntimeExceptionSse - 1);
}

/** 测试或诊断用 */
export function resetObservabilitySseCountsForTest(): void {
  activeNetworkSse = 0;
  activeRuntimeExceptionSse = 0;
}

export function getActiveNetworkSseCountForTest(): number {
  return activeNetworkSse;
}

export function getActiveRuntimeExceptionSseCountForTest(): number {
  return activeRuntimeExceptionSse;
}
