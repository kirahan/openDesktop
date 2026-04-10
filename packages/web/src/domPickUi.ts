/** UI 状态与提示文案用的复合键（同一会话可有多个 page target）。 */
export function domPickStateKey(sessionId: string, targetId: string): string {
  return `${sessionId}::${targetId}`;
}

/**
 * 从 list-window / topology 的 nodes 中取第一个 CDP `page` 目标的 targetId（供 DOM 拾取等单 page 操作）。
 */
export function pickFirstPageTargetId(
  nodes: Array<{ targetId?: string; type?: string }> | undefined,
): string | null {
  if (!nodes?.length) return null;
  const n = nodes.find((x) => (x.type ?? "").toLowerCase() === "page" && x.targetId);
  return n?.targetId ?? null;
}
