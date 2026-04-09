/** 全局并发控制台 SSE 连接上限（单路 CDP WebSocket / 会话） */
export const MAX_CONCURRENT_CONSOLE_STREAMS = 8;

let activeConsoleStreams = 0;

/**
 * 尝试占用一路控制台流名额。
 * @returns 是否成功占用（false 表示已达上限，应返回 429）
 */
export function tryAcquireConsoleStream(): boolean {
  if (activeConsoleStreams >= MAX_CONCURRENT_CONSOLE_STREAMS) return false;
  activeConsoleStreams += 1;
  return true;
}

/** 释放一路名额（与 tryAcquire 成对调用） */
export function releaseConsoleStream(): void {
  activeConsoleStreams = Math.max(0, activeConsoleStreams - 1);
}

/** 测试或诊断用 */
export function getActiveConsoleStreamCountForTest(): number {
  return activeConsoleStreams;
}

export function resetConsoleStreamCountForTest(): void {
  activeConsoleStreams = 0;
}
