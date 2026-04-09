import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafePathSegment, recipeFilePath } from "./paths.js";

describe("recipe paths", () => {
  it("builds path under recipesDir", () => {
    const p = recipeFilePath("/data/recipes", "my-app", "switch-tab");
    expect(p).toBe(path.join("/data/recipes", "my-app", "switch-tab.json"));
  });

  it("rejects unsafe segments", () => {
    expect(() => assertSafePathSegment("..", "x")).toThrow();
    expect(() => assertSafePathSegment("a/b", "x")).toThrow();
    expect(() => recipeFilePath("/r", "a/../b", "id")).toThrow();
  });
});
