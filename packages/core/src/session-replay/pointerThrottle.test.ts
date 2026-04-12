import { describe, expect, it } from "vitest";
import type { ReplayEnvelope } from "./schema.js";
import { REPLAY_SCHEMA_VERSION } from "./schema.js";
import { filterPointerMovesByMinInterval } from "./pointerThrottle.js";

function move(ts: number): ReplayEnvelope {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    type: "pointermove",
    ts,
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
  };
}

function click(ts: number): ReplayEnvelope {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    type: "click",
    ts,
    x: 1,
    y: 2,
    viewportWidth: 100,
    viewportHeight: 100,
  };
}

describe("filterPointerMovesByMinInterval", () => {
  it("reduces dense pointermove sequence", () => {
    const raw: ReplayEnvelope[] = [];
    for (let i = 0; i < 100; i++) raw.push(move(i));
    raw.push(click(500));
    const out = filterPointerMovesByMinInterval(raw, 100);
    const moves = out.filter((e) => e.type === "pointermove");
    expect(moves.length).toBeLessThan(20);
    expect(out.some((e) => e.type === "click")).toBe(true);
  });

  it("keeps all non-move events", () => {
    const out = filterPointerMovesByMinInterval([click(0), click(1), click(2)], 1000);
    expect(out.length).toBe(3);
  });
});
