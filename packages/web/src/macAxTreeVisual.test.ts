import { describe, expect, it } from "vitest";
import { parseMacAxTreePayload } from "./macAxTreeVisual.js";

describe("parseMacAxTreePayload", () => {
  it("parses truncated + root", () => {
    const r = parseMacAxTreePayload(
      JSON.stringify({
        truncated: false,
        root: { role: "AXApplication", title: "OBS", children: [] },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("root");
      expect(r.truncated).toBe(false);
      if (r.mode === "root") {
        expect(r.root).toEqual({ role: "AXApplication", title: "OBS", children: [] });
      }
    }
  });

  it("rejects non-object", () => {
    expect(parseMacAxTreePayload("404: x").ok).toBe(false);
  });
});
