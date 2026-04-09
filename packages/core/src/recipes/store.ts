import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assertSafePathSegment, recipeFilePath } from "./paths.js";
import type { OperationRecipeV1 } from "./types.js";
import { parseRecipeJson } from "./validateRecipe.js";

export type RecipeListEntry = { appSlug: string; id: string; name: string };

/**
 * 列出配方摘要；可选 `appSlug` 仅扫描该应用子目录。
 */
export async function listRecipeSummaries(
  recipesDir: string,
  appSlug?: string,
): Promise<RecipeListEntry[]> {
  const out: RecipeListEntry[] = [];
  if (appSlug) {
    assertSafePathSegment(appSlug, "appSlug");
    const dir = path.join(recipesDir, appSlug);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      const er = e as NodeJS.ErrnoException;
      if (er.code === "ENOENT") return [];
      throw e;
    }
    for (const f of names) {
      if (!f.endsWith(".json")) continue;
      const recipeId = f.slice(0, -".json".length);
      const parsed = await readRecipeFile(recipesDir, appSlug, recipeId);
      if (parsed)
        out.push({ appSlug, id: parsed.id, name: parsed.name });
    }
    return out;
  }

  let apps: string[];
  try {
    apps = await readdir(recipesDir);
  } catch (e) {
    const er = e as NodeJS.ErrnoException;
    if (er.code === "ENOENT") return [];
    throw e;
  }
  for (const slug of apps) {
    try {
      assertSafePathSegment(slug, "appSlug");
    } catch {
      continue;
    }
    const sub = path.join(recipesDir, slug);
    let names: string[];
    try {
      names = await readdir(sub);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".json")) continue;
      const recipeId = f.slice(0, -".json".length);
      const parsed = await readRecipeFile(recipesDir, slug, recipeId);
      if (parsed) out.push({ appSlug: slug, id: parsed.id, name: parsed.name });
    }
  }
  return out;
}

/**
 * 读取并校验配方文件；不存在或非法时返回 `null`（用于列表等宽松场景）。
 */
export async function readRecipeFile(
  recipesDir: string,
  appSlug: string,
  recipeId: string,
): Promise<OperationRecipeV1 | null> {
  const fp = recipeFilePath(recipesDir, appSlug, recipeId);
  let raw: string;
  try {
    raw = await readFile(fp, "utf8");
  } catch (e) {
    const er = e as NodeJS.ErrnoException;
    if (er.code === "ENOENT") return null;
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const v = parseRecipeJson(json);
  if (!v.ok) return null;
  return v.recipe;
}

export type ReadRecipeStrictResult =
  | { ok: true; recipe: OperationRecipeV1 }
  | { ok: false; kind: "missing" | "invalid"; message?: string };

/**
 * 读取单文件：缺失与校验失败区分，供 GET 单条接口返回 404/400。
 */
export async function readRecipeFileStrict(
  recipesDir: string,
  appSlug: string,
  recipeId: string,
): Promise<ReadRecipeStrictResult> {
  const fp = recipeFilePath(recipesDir, appSlug, recipeId);
  let raw: string;
  try {
    raw = await readFile(fp, "utf8");
  } catch (e) {
    const er = e as NodeJS.ErrnoException;
    if (er.code === "ENOENT") return { ok: false, kind: "missing" };
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, kind: "invalid", message: "invalid JSON" };
  }
  const v = parseRecipeJson(json);
  if (!v.ok) return { ok: false, kind: "invalid", message: v.message };
  return { ok: true, recipe: v.recipe };
}
