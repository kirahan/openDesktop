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

/** click 时 e.target 的有限摘要（体积与隐私可控） */
export type ReplayClickTarget = {
  /** HTML 标签小写，如 button */
  tagName: string;
  id?: string;
  /** 页面 className 字符串截断 */
  className?: string;
  /** data-* 属性，键为 data-foo 形式 */
  data?: Record<string, string>;
  /** 自底向上若干层的简化 CSS 路径 */
  selector?: string;
  /** 来自 getAttribute("role") */
  role?: string;
};

export type ReplayClickEvent = ReplayPointerEventBase & {
  type: "click";
  /** 可选；旧客户端或无法解析节点时可能缺失 */
  target?: ReplayClickTarget;
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

const MAX_CLICK_TAG = 32;
const MAX_CLICK_ID = 200;
const MAX_CLICK_CLASS = 240;
const MAX_CLICK_SELECTOR = 480;
const MAX_CLICK_ROLE = 64;
const MAX_DATA_KEY_LEN = 64;
const MAX_DATA_VAL_LEN = 200;
const MAX_DATA_ENTRIES = 12;

const DATA_ATTR_KEY = /^data-[a-zA-Z0-9_-]+$/;

/** 将任意字符串截断到给定最大长度（数字） */
function clip(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

/**
 * 解析注入脚本发来的 `click.target` 摘要；非法结构返回 null（整条 envelope 丢弃）。
 * @param raw 来自页面的 JSON 对象
 */
export function parseReplayClickTarget(raw: unknown): ReplayClickTarget | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tag = o.tagName;
  if (typeof tag !== "string" || tag.length === 0) return null;
  const tagName = clip(tag, MAX_CLICK_TAG);
  const out: ReplayClickTarget = { tagName };

  if (o.id !== undefined) {
    if (typeof o.id !== "string") return null;
    out.id = clip(o.id, MAX_CLICK_ID);
  }
  if (o.className !== undefined) {
    if (typeof o.className !== "string") return null;
    out.className = clip(o.className, MAX_CLICK_CLASS);
  }
  if (o.selector !== undefined) {
    if (typeof o.selector !== "string") return null;
    out.selector = clip(o.selector, MAX_CLICK_SELECTOR);
  }
  if (o.role !== undefined) {
    if (typeof o.role !== "string") return null;
    out.role = clip(o.role, MAX_CLICK_ROLE);
  }
  if (o.data !== undefined) {
    if (o.data === null || typeof o.data !== "object" || Array.isArray(o.data)) return null;
    const dataIn = o.data as Record<string, unknown>;
    const dataOut: Record<string, string> = {};
    let n = 0;
    for (const [k, v] of Object.entries(dataIn)) {
      if (n >= MAX_DATA_ENTRIES) break;
      if (k.length > MAX_DATA_KEY_LEN || !DATA_ATTR_KEY.test(k)) continue;
      if (typeof v !== "string") return null;
      dataOut[k] = clip(v, MAX_DATA_VAL_LEN);
      n++;
    }
    if (Object.keys(dataOut).length > 0) out.data = dataOut;
  }

  return out;
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
    if (o.target != null) {
      const tgt = parseReplayClickTarget(o.target);
      if (!tgt) return null;
      return { ...base, type: "click", target: tgt };
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
