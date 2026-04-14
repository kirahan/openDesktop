import { describe, expect, it } from "vitest";
import { parseMacAxAtPointStdout } from "./macAxTreeAtPoint.js";

describe("parseMacAxAtPointStdout", () => {
  it("parses success payload", () => {
    const r = parseMacAxAtPointStdout(
      JSON.stringify({
        ok: true,
        truncated: false,
        screenX: 10,
        screenY: 20,
        ancestors: [{ role: "AXWindow", title: "W" }],
        at: { role: "AXButton", title: "OK" },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.screenX).toBe(10);
      expect(r.screenY).toBe(20);
      expect(r.ancestors).toHaveLength(1);
      expect(r.at).toEqual({ role: "AXButton", title: "OK" });
      expect(r.hitFrame).toBeUndefined();
    }
  });

  it("parses success payload with hitFrame", () => {
    const r = parseMacAxAtPointStdout(
      JSON.stringify({
        ok: true,
        truncated: false,
        screenX: 1,
        screenY: 2,
        ancestors: [],
        at: { role: "AXButton", title: "OK" },
        hitFrame: { x: 10, y: 20, width: 100, height: 40 },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hitFrame).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    }
  });

  it("parses error payload", () => {
    const r = parseMacAxAtPointStdout(
      JSON.stringify({ ok: false, code: "NO_HIT", message: "none" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_HIT");
  });
});
