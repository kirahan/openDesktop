import { describe, expect, it } from "vitest";
import { parseMacAxAtPointStdout } from "./macAxTreeAtPoint.js";

describe("parseMacAxAtPointStdout (shared with Windows UIA JSON line)", () => {
  it("parses ok payload from Windows-style JSON", () => {
    const raw = JSON.stringify({
      ok: true,
      truncated: false,
      screenX: 10,
      screenY: 20,
      ancestors: [{ role: "window", title: "W", value: null }],
      at: { role: "button", title: "OK", value: null, children: [] },
      hitFrame: { x: 1, y: 2, width: 3, height: 4 },
    });
    const r = parseMacAxAtPointStdout(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.screenX).toBe(10);
      expect(r.screenY).toBe(20);
      expect(r.ancestors).toHaveLength(1);
      expect(r.hitFrame).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    }
  });

  it("parses HIT_OUTSIDE_SESSION error line", () => {
    const r = parseMacAxAtPointStdout(
      JSON.stringify({
        ok: false,
        code: "HIT_OUTSIDE_SESSION",
        message: "hit process 999 does not match session pid 123",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("HIT_OUTSIDE_SESSION");
      expect(r.message).toContain("999");
    }
  });

  it("strips UTF-8 BOM before parse", () => {
    const inner = JSON.stringify({ ok: true, truncated: false, screenX: 0, screenY: 0, ancestors: [], at: {} });
    const r = parseMacAxAtPointStdout("\uFEFF" + inner);
    expect(r.ok).toBe(true);
  });
});
