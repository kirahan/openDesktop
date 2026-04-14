/**
 * 与 Core `replayTimelineMerge` 对齐的合并序工具（Web 独立副本，避免依赖 core 包）。
 * 用于观测 UI 对多 target NDJSON 行排序展示。
 */

export type ReplayMergeSortKey = {
  mergeTs: number;
  targetId: string;
  seq: number;
};

export function compareReplayMergeOrder(a: ReplayMergeSortKey, b: ReplayMergeSortKey): number {
  if (a.mergeTs !== b.mergeTs) return a.mergeTs < b.mergeTs ? -1 : 1;
  if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  return a.seq - b.seq;
}

export function parseReplayMergeKeyFromLine(line: string): ReplayMergeSortKey | null {
  try {
    const o = JSON.parse(line) as Record<string, unknown>;
    const mergeTs = o.mergeTs;
    const targetId = o.targetId;
    const seq = o.seq;
    if (typeof mergeTs !== "number" || !Number.isFinite(mergeTs)) return null;
    if (typeof targetId !== "string" || targetId.length === 0) return null;
    if (typeof seq !== "number" || !Number.isFinite(seq)) return null;
    return { mergeTs, targetId, seq };
  } catch {
    return null;
  }
}

/** 将多行 NDJSON 按合并全序排序（无法解析的行排在后）。 */
export function sortReplayNdjsonLinesByMergeOrder(lines: string[]): string[] {
  const withIdx = lines.map((line, index) => ({ line, index, key: parseReplayMergeKeyFromLine(line) }));
  withIdx.sort((a, b) => {
    if (a.key && b.key) {
      const c = compareReplayMergeOrder(a.key, b.key);
      if (c !== 0) return c;
    } else if (a.key && !b.key) return -1;
    else if (!a.key && b.key) return 1;
    return a.index - b.index;
  });
  return withIdx.map((x) => x.line);
}
