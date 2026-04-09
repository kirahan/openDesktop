/** 支持的配方 JSON `schemaVersion`（当前仅 v1）。 */
export const OPERATION_RECIPE_SCHEMA_VERSION = 1 as const;

/**
 * DOM 兜底阶段用于从 `extractButtonCandidatesFromHtml` 结果中筛选候选的条件。
 */
export type RecipeDomMatch = {
  /** 与候选 `label` 做不区分大小写的子串匹配 */
  labelContains?: string;
  /** 与 `label.trim()` 精确相等（优先于 `labelContains`，避免「智能文档」误匹配「文档」） */
  exactLabel?: string;
  /** 候选 `score` 下限（0～1） */
  minScore?: number;
};

/**
 * 单步操作：首期仅支持 `click`，`selector` 与 Agent `click` 一致（`document.querySelector`）。
 */
export type RecipeClickStep = {
  action: "click";
  selector: string;
  /** 首次点击失败且 `domFallback` 未禁用时，用于从 DOM 探索结果中唯一选定新 selector */
  match?: RecipeDomMatch;
};

/**
 * 操作配方 v1：单文件单配方，存于 `<recipesDir>/<appSlug>/<recipeId>.json`。
 */
export type OperationRecipeV1 = {
  schemaVersion: typeof OPERATION_RECIPE_SCHEMA_VERSION;
  id: string;
  name: string;
  app?: { slug?: string; displayName?: string };
  /**
   * 是否允许在步骤失败时用 DOM 探索兜底（默认 true）。
   * 兜底需步骤提供 `match`，否则无法消歧。
   */
  domFallback?: boolean;
  steps: RecipeClickStep[];
  /** ISO8601，成功执行并持久化时由 Core 更新 */
  updatedAt?: string;
  /** 可选：调用方在 run 请求中传入，写入磁盘 */
  verifiedBuild?: string;
};
