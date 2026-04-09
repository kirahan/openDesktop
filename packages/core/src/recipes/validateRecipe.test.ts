import { describe, expect, it } from "vitest";
import { parseRecipeJson } from "./validateRecipe.js";

describe("parseRecipeJson", () => {
  it("accepts minimal valid v1 recipe", () => {
    const r = parseRecipeJson({
      schemaVersion: 1,
      id: "r1",
      name: "Test",
      steps: [{ action: "click", selector: "#a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipe.id).toBe("r1");
      expect(r.recipe.steps[0].action).toBe("click");
    }
  });

  it("rejects unknown action", () => {
    const r = parseRecipeJson({
      schemaVersion: 1,
      id: "r1",
      name: "Test",
      steps: [{ action: "scroll", selector: "#a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty selector", () => {
    const r = parseRecipeJson({
      schemaVersion: 1,
      id: "r1",
      name: "Test",
      steps: [{ action: "click", selector: "  " }],
    });
    expect(r.ok).toBe(false);
  });

  it("parses match on step", () => {
    const r = parseRecipeJson({
      schemaVersion: 1,
      id: "r1",
      name: "Test",
      steps: [
        {
          action: "click",
          selector: "#old",
          match: { labelContains: "文档", minScore: 0.5 },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipe.steps[0].match?.labelContains).toBe("文档");
      expect(r.recipe.steps[0].match?.minScore).toBe(0.5);
    }
  });
});
