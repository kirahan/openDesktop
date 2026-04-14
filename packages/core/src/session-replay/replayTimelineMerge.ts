/**
 * 多 target 矢量录制合并时间线：全序比较与 `mergeTs` 说明。
 *
 * 首期实现：`mergeTs` 取事件自带的单调时间戳（与页面 `Date.now()` 的 `ts` / `monoTs` 对齐），
 * 假定同机会话下各 target 时钟可比。跨机器回放以 `seq` + `targetId` 为 tie-break。
 *
 * @see openspec/changes/session-replay-multi-target-parallel/design.md D3
 */

/** 用于合并排序的单条事件键（通常来自 NDJSON 解析）。 */
export type ReplayMergeSortKey = {
  mergeTs: number;
  targetId: string;
  seq: number;
};

/**
 * 确定性全序比较：先 `mergeTs`，再 `targetId` 字典序，再 `seq`。
 * @returns 负数表示 a 在前，正数表示 b 在前，0 表示相等。
 */
export function compareReplayMergeOrder(a: ReplayMergeSortKey, b: ReplayMergeSortKey): number {
  if (a.mergeTs !== b.mergeTs) return a.mergeTs < b.mergeTs ? -1 : 1;
  if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
  return a.seq - b.seq;
}

/**
 * 从单条 NDJSON 行解析合并键；缺字段时返回 null（调用方可跳过该行的合并序）。
 */
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
