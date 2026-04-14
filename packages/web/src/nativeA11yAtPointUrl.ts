/** Electron 壳开启「十字线捕获」时与 Core 显式坐标轮询一致（约 10 次/秒上限） */
export const QT_AX_SHELL_CURSOR_POLL_MS = 100;

/**
 * 构建 `GET .../native-accessibility-at-point` 路径（含与列表页一致的 depth/nodes 默认）。
 * 若传入 `x`/`y` 则使用显式屏幕坐标；否则 Core 使用 nut-js 读全局鼠标。
 */
export function buildNativeAccessibilityAtPointPath(
  sessionId: string,
  opts?: { x?: number; y?: number },
): string {
  const q = new URLSearchParams({
    maxAncestorDepth: "8",
    maxLocalDepth: "4",
    maxNodes: "5000",
  });
  if (opts !== undefined && typeof opts.x === "number" && typeof opts.y === "number") {
    if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      q.set("x", String(opts.x));
      q.set("y", String(opts.y));
    }
  }
  const qs = q.toString();
  return `/v1/sessions/${encodeURIComponent(sessionId)}/native-accessibility-at-point?${qs}`;
}
