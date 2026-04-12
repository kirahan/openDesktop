import type { ReplayEnvelope } from "./schema.js";

export type PointerThrottleState = {
  lastEmittedMoveTs: number;
};

export function createPointerThrottleState(): PointerThrottleState {
  return { lastEmittedMoveTs: -Infinity };
}

/**
 * Core 侧对 pointermove 二次限流（页面内已有约 50ms 间隔；此处默认 100ms）。
 * 非 move 事件原样通过；被丢弃的 move 返回 null。
 */
export function throttlePointerMove(
  env: ReplayEnvelope,
  state: PointerThrottleState,
  minIntervalMs: number,
): ReplayEnvelope | null {
  if (env.type !== "pointermove") return env;
  const { ts } = env;
  if (ts - state.lastEmittedMoveTs < minIntervalMs) return null;
  state.lastEmittedMoveTs = ts;
  return env;
}

/**
 * 用于单元测试：对一批事件做离线限流（仅 pointermove）。
 */
export function filterPointerMovesByMinInterval(
  events: ReplayEnvelope[],
  minIntervalMs: number,
): ReplayEnvelope[] {
  const state = createPointerThrottleState();
  const out: ReplayEnvelope[] = [];
  for (const e of events) {
    const r = throttlePointerMove(e, state, minIntervalMs);
    if (r !== null) out.push(r);
  }
  return out;
}
