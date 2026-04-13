import { describe, expect, it } from "vitest";
import { parseMacAxTreeStdout } from "./macAxTree.js";

describe("parseMacAxTreeStdout", () => {
  it("parses ok payload with truncated", () => {
    const r = parseMacAxTreeStdout(
      JSON.stringify({ ok: true, truncated: true, root: { role: "AXApplication", children: [] } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).toBe(true);
      expect(r.root).toEqual({ role: "AXApplication", children: [] });
    }
  });

  it("parses error payload with ACCESSIBILITY_DISABLED", () => {
    const r = parseMacAxTreeStdout(
      JSON.stringify({
        ok: false,
        code: "ACCESSIBILITY_DISABLED",
        message: "Accessibility permission denied",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("ACCESSIBILITY_DISABLED");
      expect(r.message).toContain("Accessibility");
    }
  });

  it("returns PARSE_FAILED for non-JSON stdout", () => {
    const r = parseMacAxTreeStdout("not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PARSE_FAILED");
  });

  it("returns PARSE_FAILED for unexpected JSON shape", () => {
    const r = parseMacAxTreeStdout(JSON.stringify({ foo: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PARSE_FAILED");
  });
});
