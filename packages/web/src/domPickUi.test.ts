import { describe, expect, it } from "vitest";
import { domPickStateKey, pickFirstPageTargetId } from "./domPickUi.js";

describe("domPickStateKey", () => {
  it("joins session and target", () => {
    expect(domPickStateKey("s1", "t1")).toBe("s1::t1");
  });
});

describe("pickFirstPageTargetId", () => {
  it("returns null for empty or missing nodes", () => {
    expect(pickFirstPageTargetId(undefined)).toBeNull();
    expect(pickFirstPageTargetId([])).toBeNull();
  });

  it("skips non-page and returns first page targetId", () => {
    expect(
      pickFirstPageTargetId([
        { type: "webview", targetId: "w1" },
        { type: "page", targetId: "p1" },
        { type: "page", targetId: "p2" },
      ]),
    ).toBe("p1");
  });

  it("matches page case-insensitively", () => {
    expect(pickFirstPageTargetId([{ type: "PAGE", targetId: "x" }])).toBe("x");
  });
});
