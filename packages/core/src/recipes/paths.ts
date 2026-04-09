import path from "node:path";

/** 仅允许安全路径片段，防止 `..` 与绝对路径注入。 */
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * 校验用于目录名/文件名片段的用户输入。
 *
 * @throws Error 片段不合法时
 */
export function assertSafePathSegment(name: string, field: string): void {
  const t = name.trim();
  if (!t) {
    throw new Error(`${field}_INVALID: empty segment`);
  }
  if (t === "." || t === ".." || t.includes("/") || t.includes("\\")) {
    throw new Error(`${field}_INVALID: segment must not be . or .. or contain path separators`);
  }
  if (!SAFE_SEGMENT.test(t)) {
    throw new Error(`${field}_INVALID: use only letters, digits, dot, underscore, hyphen`);
  }
}

/**
 * 解析配方文件绝对路径：`<recipesDir>/<appSlug>/<recipeId>.json`。
 */
export function recipeFilePath(recipesDir: string, appSlug: string, recipeId: string): string {
  assertSafePathSegment(appSlug, "appSlug");
  assertSafePathSegment(recipeId, "recipeId");
  return path.join(recipesDir, appSlug, `${recipeId}.json`);
}
