/**
 * 通过 CDP Runtime.evaluate（returnByValue）反射枚举 globalThis 可观测属性，用于探测壳暴露 API。
 */

import { evaluateOnTarget } from "./browserClient.js";

/** 与 eval/open 等脚本类动作对齐的默认上限 */
export const DEFAULT_MAX_GLOBAL_KEYS = 8000;

/** interestPattern 最大长度，降低 ReDoS 与注入面 */
export const MAX_INTEREST_PATTERN_LENGTH = 256;

/** 单页属性条数硬上限 */
export const ABSOLUTE_MAX_GLOBAL_KEYS = 50_000;

export type GlobalEntry = {
  name: string;
  kind: string;
  functionName?: string;
  detail?: string;
};

export type RendererGlobalSnapshot = {
  collectedAt: string;
  locationHref: string | null;
  userAgent: string | null;
  globalNames: string[];
  entries: GlobalEntry[];
  truncated: boolean;
  interestMatches?: string[];
};

export type RendererGlobalSnapshotOptions = {
  interestPattern?: string;
  maxKeys?: number;
};

/**
 * 校验可选的 interest 正则字符串；合法时可在页面内 `new RegExp(source)`。
 */
export function parseInterestPattern(input: unknown):
  | { ok: true; pattern: string | undefined }
  | { ok: false; message: string } {
  if (input === undefined || input === null) return { ok: true, pattern: undefined };
  if (typeof input !== "string") {
    return { ok: false, message: "interestPattern must be a string" };
  }
  if (input.length > MAX_INTEREST_PATTERN_LENGTH) {
    return { ok: false, message: `interestPattern exceeds ${MAX_INTEREST_PATTERN_LENGTH} characters` };
  }
  try {
    void new RegExp(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `invalid interestPattern: ${msg}` };
  }
  return { ok: true, pattern: input };
}

function clampMaxKeys(n: unknown): number {
  if (n === undefined || n === null) return DEFAULT_MAX_GLOBAL_KEYS;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_GLOBAL_KEYS;
  const k = Math.floor(n);
  if (k < 1) return 1;
  return Math.min(k, ABSOLUTE_MAX_GLOBAL_KEYS);
}

/**
 * 生成在目标页执行的 IIFE 源码；interest 由 Node 校验后以内联字面量注入，避免拼接注入。
 */
export function buildGlobalSnapshotExpression(maxKeys: number, interestPattern: string | undefined): string {
  const mk = Math.min(Math.max(1, Math.floor(maxKeys)), ABSOLUTE_MAX_GLOBAL_KEYS);
  const interestLiteral =
    interestPattern === undefined ? "null" : JSON.stringify(interestPattern);
  return `(() => {
  var maxKeys = ${mk};
  var interestSource = ${interestLiteral};
  function collectNames() {
    var seen = new Set();
    var out = [];
    var obj = globalThis;
    while (obj && obj !== Object.prototype) {
      try {
        var names = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < names.length; i++) {
          var k = names[i];
          if (!seen.has(k)) { seen.add(k); out.push(k); }
        }
      } catch (e) {}
      obj = Object.getPrototypeOf(obj);
    }
    out.sort();
    return out;
  }
  var names = collectNames();
  var truncated = false;
  if (names.length > maxKeys) {
    truncated = true;
    names = names.slice(0, maxKeys);
  }
  function describe(name) {
    try {
      var v = globalThis[name];
      var t = typeof v;
      if (t === "function") {
        var fnName = "";
        try { fnName = v.name || ""; } catch (e2) {}
        return { name: name, kind: "function", functionName: fnName || undefined };
      }
      return { name: name, kind: t };
    } catch (e) {
      return { name: name, kind: "error", detail: String(e) };
    }
  }
  var entries = names.map(describe);
  var interestMatches = undefined;
  if (interestSource !== null && interestSource !== undefined) {
    try {
      var rx = new RegExp(interestSource);
      interestMatches = names.filter(function (n) { return rx.test(n); });
    } catch (e) {
      interestMatches = [];
    }
  }
  return {
    collectedAt: new Date().toISOString(),
    locationHref: typeof location !== "undefined" ? location.href : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    globalNames: names,
    entries: entries,
    interestMatches: interestMatches,
    truncated: truncated
  };
})()`;
}

export function normalizeSnapshotResult(
  value: unknown,
): { snapshot: RendererGlobalSnapshot } | { error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "snapshot result is not an object" };
  }
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.globalNames)) {
    return { error: "snapshot.globalNames missing or not array" };
  }
  if (!Array.isArray(o.entries)) {
    return { error: "snapshot.entries missing or not array" };
  }
  const truncated = Boolean(o.truncated);
  const collectedAt = typeof o.collectedAt === "string" ? o.collectedAt : "";
  const locationHref =
    o.locationHref === null || typeof o.locationHref === "string" ? (o.locationHref as string | null) : null;
  const userAgent =
    o.userAgent === null || typeof o.userAgent === "string" ? (o.userAgent as string | null) : null;
  let interestMatches: string[] | undefined;
  if (o.interestMatches !== undefined) {
    if (!Array.isArray(o.interestMatches)) {
      return { error: "snapshot.interestMatches is not an array" };
    }
    interestMatches = o.interestMatches.filter((x): x is string => typeof x === "string");
  }
  return {
    snapshot: {
      collectedAt,
      locationHref,
      userAgent,
      globalNames: o.globalNames.filter((x): x is string => typeof x === "string"),
      entries: o.entries as GlobalEntry[],
      truncated,
      interestMatches,
    },
  };
}

/**
 * 对指定 CDP target 执行全局反射枚举；实现为单次 Runtime.evaluate（returnByValue），非跨进程持有 window。
 */
export async function collectRendererGlobalSnapshotOnTarget(
  cdpPort: number,
  targetId: string,
  opts?: RendererGlobalSnapshotOptions,
): Promise<{ snapshot: RendererGlobalSnapshot } | { error: string }> {
  const maxKeys = clampMaxKeys(opts?.maxKeys);
  const ip = parseInterestPattern(opts?.interestPattern);
  if (!ip.ok) return { error: ip.message };

  const expr = buildGlobalSnapshotExpression(maxKeys, ip.pattern);
  const ev = await evaluateOnTarget(cdpPort, targetId, expr);
  if ("error" in ev) return { error: ev.error };

  const n = normalizeSnapshotResult(ev.result);
  if ("error" in n) return { error: n.error };
  return { snapshot: n.snapshot };
}
