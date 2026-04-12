import { describe, expect, it } from "vitest";
import { mapReplayCoordsToOverlay } from "./replayOverlayMath.js";

describe("mapReplayCoordsToOverlay", () => {
  it("scales to container size", () => {
    const p = mapReplayCoordsToOverlay(400, 300, 800, 600, 400, 300);
    expect(p.leftPx).toBeCloseTo(200, 5);
    expect(p.topPx).toBeCloseTo(150, 5);
  });

  it("maps origin to top-left", () => {
    const p = mapReplayCoordsToOverlay(0, 0, 100, 100, 50, 50);
    expect(p.leftPx).toBe(0);
    expect(p.topPx).toBe(0);
  });
});
