import { extractButtonCandidatesFromHtml } from "../cdp/domExplore.js";
import { pickUniqueCandidate } from "./pickCandidate.js";
import type { OperationRecipeV1, RecipeClickStep } from "./types.js";

export type RunRecipeDeps = {
  allowScriptExecution: boolean;
  click: (selector: string) => Promise<{ ok: true } | { error: string }>;
  getOuterHtml: () => Promise<{ html: string } | { error: string; truncated?: boolean }>;
};

export type RunRecipeFailure = {
  ok: false;
  code:
    | "SCRIPT_NOT_ALLOWED"
    | "CLICK_FAILED"
    | "DOM_FAILED"
    | "FALLBACK_NO_MATCH"
    | "FALLBACK_AMBIGUOUS";
  message: string;
  stepIndex: number;
};

export type RunRecipeSuccess = {
  ok: true;
  /** 执行后的配方（含可能被兜底更新的 selector） */
  recipe: OperationRecipeV1;
  /** 是否有任一步 selector 相对磁盘文件发生变化 */
  selectorsChanged: boolean;
};

function cloneRecipe(r: OperationRecipeV1): OperationRecipeV1 {
  return JSON.parse(JSON.stringify(r)) as OperationRecipeV1;
}

/**
 * 在 CDP 会话上下文中逐步执行配方：`click` 优先，失败时可按步骤 `match` 做 DOM 探索并重试。
 */
export async function runOperationRecipe(
  recipe: OperationRecipeV1,
  deps: RunRecipeDeps,
): Promise<RunRecipeSuccess | RunRecipeFailure> {
  if (!deps.allowScriptExecution) {
    return {
      ok: false,
      code: "SCRIPT_NOT_ALLOWED",
      message: "allowScriptExecution is false for this session",
      stepIndex: 0,
    };
  }

  const working = cloneRecipe(recipe);
  const domFallbackDefault = working.domFallback !== false;
  let selectorsChanged = false;

  for (let i = 0; i < working.steps.length; i++) {
    const step = working.steps[i] as RecipeClickStep;
    const tryClick = async (selector: string) => deps.click(selector.trim());

    const r = await tryClick(step.selector);
    if ("error" in r) {
      const firstErr = r.error;
      const canTry =
        domFallbackDefault &&
        step.match !== undefined &&
        step.match !== null &&
        Object.keys(step.match).length > 0;

      if (!canTry) {
        return {
          ok: false,
          code: "CLICK_FAILED",
          message: firstErr,
          stepIndex: i,
        };
      }

      const dom = await deps.getOuterHtml();
      if ("error" in dom) {
        return {
          ok: false,
          code: "DOM_FAILED",
          message: dom.error,
          stepIndex: i,
        };
      }

      const exploreMin =
        step.match?.minScore !== undefined ? step.match.minScore : 0;
      const { candidates } = extractButtonCandidatesFromHtml(dom.html, {
        maxCandidates: 128,
        minScore: exploreMin,
        includeAnchorButtons: true,
        includeRoleTabs: true,
        includeTabSurfaceHints: true,
      });
      const picked = pickUniqueCandidate(candidates, step.match);
      if (!picked.ok) {
        return {
          ok: false,
          code: picked.reason === "ambiguous" ? "FALLBACK_AMBIGUOUS" : "FALLBACK_NO_MATCH",
          message: picked.detail ?? picked.reason,
          stepIndex: i,
        };
      }

      const r2 = await tryClick(picked.selector);
      if ("error" in r2) {
        return {
          ok: false,
          code: "CLICK_FAILED",
          message: r2.error,
          stepIndex: i,
        };
      }
      if (picked.selector !== step.selector) {
        working.steps[i] = { ...step, selector: picked.selector };
        selectorsChanged = true;
      }
    }
  }

  working.updatedAt = new Date().toISOString();
  return { ok: true, recipe: working, selectorsChanged };
}
