import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPosition = vi.fn();

vi.mock("@nut-tree/nut-js", () => ({
  mouse: { getPosition: () => getPosition() },
}));

describe("getGlobalMousePosition", () => {
  let platformDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    platformDesc = Object.getOwnPropertyDescriptor(process, "platform");
  });

  afterEach(() => {
    getPosition.mockReset();
    if (platformDesc) Object.defineProperty(process, "platform", platformDesc);
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  it("returns rounded coordinates on success (darwin)", async () => {
    setPlatform("darwin");
    getPosition.mockResolvedValue({ x: 100.4, y: 200.6 });
    vi.resetModules();
    const { getGlobalMousePosition } = await import("./getGlobalMousePosition.js");
    const r = await getGlobalMousePosition();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.x).toBe(100);
      expect(r.y).toBe(201);
    }
  });

  it("returns MOUSE_POSITION_UNAVAILABLE on nut-js failure", async () => {
    setPlatform("darwin");
    getPosition.mockRejectedValue(new Error("boom"));
    vi.resetModules();
    const { getGlobalMousePosition } = await import("./getGlobalMousePosition.js");
    const r = await getGlobalMousePosition();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MOUSE_POSITION_UNAVAILABLE");
  });

  it("returns unavailable on linux", async () => {
    setPlatform("linux");
    vi.resetModules();
    const { getGlobalMousePosition } = await import("./getGlobalMousePosition.js");
    const r = await getGlobalMousePosition();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MOUSE_POSITION_UNAVAILABLE");
  });
});
