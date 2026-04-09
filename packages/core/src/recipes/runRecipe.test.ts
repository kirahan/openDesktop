import { describe, expect, it, vi } from "vitest";
import type { OperationRecipeV1 } from "./types.js";
import { runOperationRecipe } from "./runRecipe.js";

const baseRecipe = (): OperationRecipeV1 => ({
  schemaVersion: 1,
  id: "r1",
  name: "t",
  steps: [
    { action: "click", selector: "#a" },
    { action: "click", selector: "#b" },
  ],
});

describe("runOperationRecipe", () => {
  it("returns 403 when script disabled", async () => {
    const r = await runOperationRecipe(baseRecipe(), {
      allowScriptExecution: false,
      click: async () => ({ ok: true }),
      getOuterHtml: async () => ({ html: "<html></html>" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCRIPT_NOT_ALLOWED");
  });

  it("calls click in order and stops on failure without match", async () => {
    const click = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ error: "bad" });
    const r = await runOperationRecipe(baseRecipe(), {
      allowScriptExecution: true,
      click,
      getOuterHtml: async () => ({ html: "<html></html>" }),
    });
    expect(click).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CLICK_FAILED");
  });

  it("uses dom fallback when match provided and retries click", async () => {
    const html = `<!DOCTYPE html><html><body>
      <button id="wrong">old</button>
      <div role="tab" id="tab-doc">文档</div>
    </body></html>`;
    const click = vi
      .fn()
      .mockResolvedValueOnce({ error: "click_no_element" })
      .mockResolvedValueOnce({ ok: true });
    const recipe: OperationRecipeV1 = {
      schemaVersion: 1,
      id: "r1",
      name: "t",
      steps: [
        {
          action: "click",
          selector: "#gone",
          match: { labelContains: "文档", minScore: 0 },
        },
      ],
    };
    const r = await runOperationRecipe(recipe, {
      allowScriptExecution: true,
      click,
      getOuterHtml: async () => ({ html }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selectorsChanged).toBe(true);
      expect(r.recipe.steps[0].selector).not.toBe("#gone");
      expect(click).toHaveBeenCalledTimes(2);
    }
  });
});
