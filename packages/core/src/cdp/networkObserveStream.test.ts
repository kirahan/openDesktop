import { describe, expect, it } from "vitest";
import { allowNetworkSseEmitPerSecond } from "./networkObserveStream.js";

describe("allowNetworkSseEmitPerSecond", () => {
  it("allows up to maxPerSecond emits in the same second then blocks", () => {
    let state = { secondEpoch: 0, countInSecond: 0 };
    const max = 3;
    for (let i = 0; i < 3; i++) {
      const r = allowNetworkSseEmitPerSecond(state, max);
      expect(r.allowed).toBe(true);
      state = r.state;
    }
    const blocked = allowNetworkSseEmitPerSecond(state, max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.state.countInSecond).toBe(3);
  });
});
