import { describe, expect, it } from "vitest";
import { buildNativeAccessibilityAtPointPath, QT_AX_SHELL_CURSOR_POLL_MS } from "./nativeA11yAtPointUrl.js";

describe("buildNativeAccessibilityAtPointPath", () => {
  it("builds base path with default depth params", () => {
    expect(buildNativeAccessibilityAtPointPath("sid-1")).toBe(
      "/v1/sessions/sid-1/native-accessibility-at-point?maxAncestorDepth=8&maxLocalDepth=4&maxNodes=5000",
    );
  });

  it("appends explicit screen coordinates when finite", () => {
    const p = buildNativeAccessibilityAtPointPath("a b", { x: 12.5, y: -3 });
    expect(p).toContain("x=12.5");
    expect(p).toContain("y=-3");
    expect(p).toContain(encodeURIComponent("a b"));
  });

  it("ignores non-finite coordinates", () => {
    const base = buildNativeAccessibilityAtPointPath("x", { x: NaN, y: 1 });
    expect(base).not.toContain("x=NaN");
  });
});

describe("QT_AX_SHELL_CURSOR_POLL_MS", () => {
  it("matches design ceiling (~10Hz)", () => {
    expect(QT_AX_SHELL_CURSOR_POLL_MS).toBeGreaterThanOrEqual(50);
    expect(QT_AX_SHELL_CURSOR_POLL_MS).toBeLessThanOrEqual(200);
  });
});
