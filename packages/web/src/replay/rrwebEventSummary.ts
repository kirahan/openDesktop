/**
 * rrweb `event.type` 数值与含义（与 rrweb EventType 对齐，仅用于 UI 提示）。
 * @see https://github.com/rrweb-io/rrweb/blob/master/packages/types/src/index.ts
 */
const RRWEB_TYPE_HINT: Record<number, string> = {
  0: "DomContentLoaded",
  1: "Load",
  2: "FullSnapshot",
  3: "IncrementalSnapshot",
  4: "Meta",
  5: "Custom",
  6: "Plugin",
};

/**
 * 从 UI 侧累积的未知事件列表提取诊断信息，用于区分「未收到数据」与「Replayer 未出画」。
 */
export function summarizeRrwebEventsForUi(events: unknown[]): {
  count: number;
  /** 每条事件的 type，无法解析时为 null */
  typeCodes: Array<number | null>;
  /** 前 maxTypes 条的简短说明，如 "4:Meta, 2:FullSnapshot" */
  typeSequenceLabel: string;
  lastEventJsonPreview: string;
  hasMeta: boolean;
  hasFullSnapshot: boolean;
} {
  const typeCodes: Array<number | null> = [];
  let hasMeta = false;
  let hasFullSnapshot = false;
  for (const ev of events) {
    let code: number | null = null;
    if (ev !== null && typeof ev === "object" && "type" in ev) {
      const t = (ev as { type: unknown }).type;
      if (typeof t === "number" && Number.isFinite(t)) {
        code = t;
        if (t === 4) hasMeta = true;
        if (t === 2) hasFullSnapshot = true;
      }
    }
    typeCodes.push(code);
  }

  const maxTypes = 48;
  const slice = typeCodes.slice(0, maxTypes);
  const typeSequenceLabel = slice
    .map((c) => {
      if (c === null) return "?";
      const hint = RRWEB_TYPE_HINT[c] ?? `t${String(c)}`;
      return `${String(c)}:${hint}`;
    })
    .join(", ");

  let lastEventJsonPreview = "";
  if (events.length > 0) {
    const last = events[events.length - 1];
    try {
      lastEventJsonPreview = JSON.stringify(last, null, 0);
    } catch {
      lastEventJsonPreview = String(last);
    }
    if (lastEventJsonPreview.length > 900) {
      lastEventJsonPreview = `${lastEventJsonPreview.slice(0, 900)}…`;
    }
  }

  return {
    count: events.length,
    typeCodes,
    typeSequenceLabel,
    lastEventJsonPreview,
    hasMeta,
    hasFullSnapshot,
  };
}
