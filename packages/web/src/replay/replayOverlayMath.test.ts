import { describe, expect, it } from "vitest";
import { mapReplayCoordsToObjectFitContain, mapReplayCoordsToOverlay } from "./replayOverlayMath.js";

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

describe("mapReplayCoordsToObjectFitContain", () => {
  it("与 contain 同宽高比时铺满容器，与 stretch 映射一致", () => {
    const p = mapReplayCoordsToObjectFitContain(400, 300, 800, 600, 400, 300);
    expect(p.leftPx).toBeCloseTo(200, 5);
    expect(p.topPx).toBeCloseTo(150, 5);
  });

  it("更宽的容器时水平居中，映射到中间条带", () => {
    const p = mapReplayCoordsToObjectFitContain(400, 300, 800, 600, 500, 300);
    expect(p.leftPx).toBeCloseTo(250, 5);
    expect(p.topPx).toBeCloseTo(150, 5);
  });
});
