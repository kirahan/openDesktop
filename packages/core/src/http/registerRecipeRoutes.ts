import { Router, type Request, type Response } from "express";
import { appendAudit } from "../audit.js";
import { clickOnTarget, getTargetDocumentOuterHtml } from "../cdp/browserClient.js";
import type { CoreConfig } from "../config.js";
import { assertSafePathSegment, recipeFilePath } from "../recipes/paths.js";
import { runOperationRecipe } from "../recipes/runRecipe.js";
import { listRecipeSummaries, readRecipeFileStrict } from "../recipes/store.js";
import { writeJsonAtomic } from "../recipes/atomicWrite.js";
import type { SessionManager } from "../session/manager.js";

function jsonError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function runFailureStatus(code: string): number {
  if (code === "SCRIPT_NOT_ALLOWED") return 403;
  if (code === "FALLBACK_NO_MATCH" || code === "FALLBACK_AMBIGUOUS") return 422;
  return 502;
}

export interface RecipeRouteDeps {
  config: CoreConfig;
  manager: SessionManager;
  dataDir: string;
}

/**
 * Agent 下的操作配方 HTTP：`GET/POST .../recipes`。
 */
export function registerAgentRecipeRoutes(agent: Router, deps: RecipeRouteDeps): void {
  const { config, manager, dataDir } = deps;
  const recipesDir = config.recipesDir;

  agent.get("/sessions/:sessionId/recipes", async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    const app = typeof req.query.app === "string" ? req.query.app.trim() : undefined;
    if (app) {
      try {
        assertSafePathSegment(app, "app");
      } catch (e) {
        return jsonError(res, 400, "VALIDATION_ERROR", e instanceof Error ? e.message : String(e));
      }
    }
    try {
      const recipes = await listRecipeSummaries(recipesDir, app || undefined);
      res.json({ recipes });
    } catch (e) {
      jsonError(res, 500, "RECIPES_LIST_FAILED", e instanceof Error ? e.message : String(e));
    }
  });

  agent.get("/sessions/:sessionId/recipes/:appSlug/:recipeId", async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    const { appSlug, recipeId } = req.params;
    try {
      assertSafePathSegment(appSlug, "appSlug");
      assertSafePathSegment(recipeId, "recipeId");
    } catch (e) {
      return jsonError(res, 400, "VALIDATION_ERROR", e instanceof Error ? e.message : String(e));
    }
    try {
      const r = await readRecipeFileStrict(recipesDir, appSlug, recipeId);
      if (!r.ok && r.kind === "missing") {
        return jsonError(res, 404, "RECIPE_NOT_FOUND", "Recipe not found");
      }
      if (!r.ok) {
        return jsonError(res, 400, "INVALID_RECIPE", r.message ?? "invalid recipe file");
      }
      res.json({ recipe: r.recipe });
    } catch (e) {
      jsonError(res, 500, "RECIPE_READ_FAILED", e instanceof Error ? e.message : String(e));
    }
  });

  agent.post("/sessions/:sessionId/recipes/:appSlug/:recipeId/run", async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId;
    const body = req.body as { targetId?: string; verifiedBuild?: string };
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) {
      return jsonError(res, 400, "VALIDATION_ERROR", "targetId required");
    }

    const ctx = manager.getOpsContext(sessionId);
    if (!ctx) return jsonError(res, 404, "SESSION_NOT_FOUND", "Session not found");
    if (ctx.state !== "running" || !ctx.cdpPort) {
      return jsonError(res, 503, "CDP_NOT_READY", "Session has no active CDP endpoint");
    }
    if (!ctx.allowScriptExecution) {
      return jsonError(res, 403, "SCRIPT_NOT_ALLOWED", "allowScriptExecution is false for this session");
    }

    const { appSlug, recipeId } = req.params;
    try {
      assertSafePathSegment(appSlug, "appSlug");
      assertSafePathSegment(recipeId, "recipeId");
    } catch (e) {
      return jsonError(res, 400, "VALIDATION_ERROR", e instanceof Error ? e.message : String(e));
    }
    let loaded: Awaited<ReturnType<typeof readRecipeFileStrict>>;
    try {
      loaded = await readRecipeFileStrict(recipesDir, appSlug, recipeId);
    } catch (e) {
      return jsonError(res, 500, "RECIPE_READ_FAILED", e instanceof Error ? e.message : String(e));
    }
    if (!loaded.ok && loaded.kind === "missing") {
      return jsonError(res, 404, "RECIPE_NOT_FOUND", "Recipe not found");
    }
    if (!loaded.ok) {
      return jsonError(res, 400, "INVALID_RECIPE", loaded.message ?? "invalid recipe file");
    }

    const recipe = loaded.recipe;
    const audit = async (ok: boolean, extra?: Record<string, unknown>) => {
      await appendAudit(dataDir, {
        type: "agent.recipe",
        sessionId,
        appSlug,
        recipeId,
        ok,
        ...extra,
      }).catch(() => undefined);
    };

    const run = await runOperationRecipe(recipe, {
      allowScriptExecution: ctx.allowScriptExecution,
      click: (selector) => clickOnTarget(ctx.cdpPort!, targetId, selector),
      getOuterHtml: async () => getTargetDocumentOuterHtml(ctx.cdpPort!, targetId),
    });

    if (!run.ok) {
      await audit(false, { code: run.code, stepIndex: run.stepIndex });
      return jsonError(res, runFailureStatus(run.code), run.code, run.message);
    }

    const merged = { ...run.recipe };
    if (typeof body.verifiedBuild === "string" && body.verifiedBuild.trim()) {
      merged.verifiedBuild = body.verifiedBuild.trim();
    }

    const filePath = recipeFilePath(recipesDir, appSlug, recipeId);
    try {
      await writeJsonAtomic(filePath, merged);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await audit(false, { reason: "persist_failed", message: msg });
      return res.status(500).json({
        error: { code: "RECIPE_PERSIST_FAILED", message: msg },
        executionOk: true,
        recipe: merged,
        selectorsChanged: run.selectorsChanged,
        persisted: false,
      });
    }

    await audit(true, { selectorsChanged: run.selectorsChanged, targetId });
    return res.json({
      ok: true,
      recipe: merged,
      selectorsChanged: run.selectorsChanged,
      persisted: true,
    });
  });
}
