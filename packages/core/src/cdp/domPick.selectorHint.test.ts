import { describe, expect, it } from "vitest";
import { buildDomPickSelectorHint } from "./domPick.js";

describe("buildDomPickSelectorHint", () => {
  it("prefers #id when safe", () => {
    expect(buildDomPickSelectorHint("div", { id: "root" })).toBe("div#root");
  });

  it("uses attribute id when id has special chars", () => {
    expect(buildDomPickSelectorHint("span", { id: 'a"b' })).toBe('span[id="a\\\"b"]');
  });

  it("prefers data-testid after id missing", () => {
    expect(buildDomPickSelectorHint("button", { "data-testid": "submit" })).toBe(
      'button[data-testid="submit"]',
    );
  });

  it("uses first safe classes", () => {
    expect(buildDomPickSelectorHint("div", { class: "foo bar" })).toBe("div.foo.bar");
  });

  it("falls back to tag only", () => {
    expect(buildDomPickSelectorHint("section", {})).toBe("section");
  });
});
