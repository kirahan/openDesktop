/**
 * 页面矢量录制事件与结构快照（第一期：主 frame、CSS 视口坐标）。
 */

export const REPLAY_SCHEMA_VERSION = 1 as const;

export type ReplayEventType =
  | "pointermove"
  | "pointerdown"
  | "click"
  | "structure_snapshot";

/** 与页面/服务端约定一致的坐标系：相对视口的 CSS 像素（clientX/Y），附视口宽高。 */
export type ReplayPointerEventBase = {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  type: "pointermove" | "pointerdown" | "click";
  /** 毫秒时间戳（Unix epoch，与 Date.now() 一致） */
  ts: number;
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type ReplayPointerMoveEvent = ReplayPointerEventBase & {
  type: "pointermove";
};

export type ReplayPointerDownEvent = ReplayPointerEventBase & {
  type: "pointerdown";
  button: number;
};

export type ReplayClickEvent = ReplayPointerEventBase & {
  type: "click";
};

export type ReplayStructureSnapshotEvent = {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  type: "structure_snapshot";
  ts: number;
  /** 第一期：轻量文本摘要，非完整 DOM */
  format: "text_digest";
  text: string;
};

export type ReplayEnvelope =
  | ReplayPointerMoveEvent
  | ReplayPointerDownEvent
  | ReplayClickEvent
  | ReplayStructureSnapshotEvent;

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * 校验并解析单条录制事件；非法 payload 返回 null（不抛错，便于 CDP 侧容错）。
 */
export function parseReplayEnvelope(raw: unknown): ReplayEnvelope | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== REPLAY_SCHEMA_VERSION) return null;

  const ts = o.ts;
  if (!isFiniteNum(ts)) return null;

  const t = o.type;
  if (t === "structure_snapshot") {
    const format = o.format;
    const text = o.text;
    if (format !== "text_digest") return null;
    if (typeof text !== "string") return null;
    return {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      type: "structure_snapshot",
      ts,
      format: "text_digest",
      text,
    };
  }

  if (t === "pointermove" || t === "pointerdown" || t === "click") {
    if (!isFiniteNum(o.x) || !isFiniteNum(o.y)) return null;
    if (!isFiniteNum(o.viewportWidth) || !isFiniteNum(o.viewportHeight)) return null;
    const base = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      ts,
      x: o.x,
      y: o.y,
      viewportWidth: o.viewportWidth,
      viewportHeight: o.viewportHeight,
    };
    if (t === "pointermove") {
      return { ...base, type: "pointermove" };
    }
    if (t === "pointerdown") {
      if (!isFiniteNum(o.button)) return null;
      return { ...base, type: "pointerdown", button: o.button };
    }
    return { ...base, type: "click" };
  }

  return null;
}

/**
 * 从 CDP `Runtime.bindingCalled` 的 payload 字符串解析。
 */
export function parseReplayEnvelopeJsonString(payload: string): ReplayEnvelope | null {
  try {
    const v = JSON.parse(payload) as unknown;
    return parseReplayEnvelope(v);
  } catch {
    return null;
  }
}
