/**
 * CDP `Runtime.exceptionThrown` → 稳定 JSON：栈帧与异常文案（条数/长度上限、URL 裁剪）。
 */

/** 单响应中最大栈帧数。 */
export const MAX_RUNTIME_STACK_FRAMES = 64;
/** 异常 `text` 最大字符数（超出截断）。 */
export const MAX_RUNTIME_EXCEPTION_TEXT = 4096;
/** 单帧内函数字符串等展示字段上限。 */
export const MAX_RUNTIME_STRING_FIELD = 512;
/** 与 Network 观测展示 URL 上限对齐。 */
const MAX_STACK_URL_DISPLAY_LENGTH = 2048;

export type RuntimeStackFrame = {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
};

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** 与 networkObserve.formatUrlForObserve 同语义，避免循环依赖单独实现。 */
function formatUrlForStackDisplay(rawUrl: string, stripQuery: boolean, maxLen: number): string {
  let u = rawUrl;
  if (stripQuery) {
    try {
      const p = new URL(rawUrl);
      p.search = "";
      p.hash = "";
      u = p.toString();
    } catch {
      const q = rawUrl.indexOf("?");
      const h = rawUrl.indexOf("#");
      const cut = q >= 0 ? q : h >= 0 ? h : rawUrl.length;
      u = rawUrl.slice(0, cut);
    }
  }
  if (u.length > maxLen) return `${u.slice(0, maxLen)}…`;
  return u;
}

/**
 * 将 CDP `stackTrace.callFrames` 映射为稳定帧列表（条数上限、URL 裁剪）。
 */
export function mapStackTraceCallFrames(stackTrace: unknown): RuntimeStackFrame[] {
  if (!stackTrace || typeof stackTrace !== "object") return [];
  const st = stackTrace as { callFrames?: unknown[] };
  const frames = Array.isArray(st.callFrames) ? st.callFrames : [];
  const out: RuntimeStackFrame[] = [];
  const cap = Math.min(frames.length, MAX_RUNTIME_STACK_FRAMES);
  for (let i = 0; i < cap; i++) {
    const f = frames[i];
    if (!f || typeof f !== "object") continue;
    const cf = f as {
      functionName?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
    const row: RuntimeStackFrame = {};
    if (typeof cf.functionName === "string") {
      row.functionName = truncateStr(cf.functionName, MAX_RUNTIME_STRING_FIELD);
    }
    if (typeof cf.url === "string" && cf.url.length > 0) {
      row.url = formatUrlForStackDisplay(cf.url, true, MAX_STACK_URL_DISPLAY_LENGTH);
    }
    if (typeof cf.lineNumber === "number" && Number.isFinite(cf.lineNumber)) {
      row.lineNumber = cf.lineNumber;
    }
    if (typeof cf.columnNumber === "number" && Number.isFinite(cf.columnNumber)) {
      row.columnNumber = cf.columnNumber;
    }
    out.push(row);
  }
  return out;
}

export function truncateExceptionText(raw: string): { text: string; truncated: boolean } {
  if (raw.length <= MAX_RUNTIME_EXCEPTION_TEXT) return { text: raw, truncated: false };
  return { text: `${raw.slice(0, MAX_RUNTIME_EXCEPTION_TEXT)}…`, truncated: true };
}

/**
 * 解析 `Runtime.exceptionThrown` 的 `params`（CDP 文档中的 `timestamp` + `exceptionDetails`）。
 */
export function parseExceptionDetailsFromThrown(params: unknown): {
  text: string;
  textTruncated: boolean;
  frames: RuntimeStackFrame[];
} {
  if (!params || typeof params !== "object") {
    return { text: "", textTruncated: false, frames: [] };
  }
  const p = params as { exceptionDetails?: unknown };
  const d = p.exceptionDetails;
  if (!d || typeof d !== "object") {
    return { text: "", textTruncated: false, frames: [] };
  }
  const det = d as {
    text?: string;
    stackTrace?: unknown;
  };
  const rawText = typeof det.text === "string" ? det.text : "";
  const t = truncateExceptionText(rawText);
  const frames = mapStackTraceCallFrames(det.stackTrace);
  return { text: t.text, textTruncated: t.truncated, frames };
}
