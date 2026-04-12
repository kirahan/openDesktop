/**
 * 从已过滤的矢量 NDJSON 行（schemaVersion 1）解析事件类型。
 */
function replayLineType(line: string): string | undefined {
  try {
    const o = JSON.parse(line) as { schemaVersion?: unknown; type?: unknown };
    if (o.schemaVersion !== 1 || typeof o.type !== "string") return undefined;
    return o.type;
  } catch {
    return undefined;
  }
}

/**
 * 按 `segment_start` / `segment_end` 将矢量 NDJSON 行拆成多段，每段对应一次落盘制品。
 *
 * - 无 `segment_start`：整份作为单段（与旧行为一致）。
 * - 有 `segment_start`：仅输出每对闭合区间（含 `segment_start` 与 `segment_end` 两行）。
 *   段前、段间、段后的其它行（多为 pointermove）不单独落盘，避免产生「仅 viewport、steps 为空」的制品。
 * - 若最后一处 `segment_start` 后没有 `segment_end`，则末段包含从该 `segment_start` 到缓冲区末尾。
 */
export function splitReplayLinesBySegmentMarkers(lines: string[]): string[][] {
  if (lines.length === 0) return [];

  let hasSegmentStart = false;
  for (let j = 0; j < lines.length; j++) {
    if (replayLineType(lines[j]) === "segment_start") {
      hasSegmentStart = true;
      break;
    }
  }
  if (!hasSegmentStart) {
    return lines.length > 0 ? [lines] : [];
  }

  const n = lines.length;
  let i = 0;
  const chunks: string[][] = [];

  while (i < n) {
    while (i < n && replayLineType(lines[i]) !== "segment_start") {
      i++;
    }
    if (i >= n) break;

    const segStart = i;
    i++;
    while (i < n && replayLineType(lines[i]) !== "segment_end") {
      i++;
    }
    if (i < n) {
      chunks.push(lines.slice(segStart, i + 1));
      i++;
    } else {
      chunks.push(lines.slice(segStart));
    }
  }

  return chunks.filter((c) => c.length > 0);
}
