import {
  OPERATION_RECIPE_SCHEMA_VERSION,
  type OperationRecipeV1,
  type RecipeClickStep,
  type RecipeDomMatch,
} from "./types.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseMatch(raw: unknown): RecipeDomMatch | "invalid" | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) return "invalid";
  const m: RecipeDomMatch = {};
  if (raw.exactLabel !== undefined) {
    if (typeof raw.exactLabel !== "string" || !raw.exactLabel.trim()) return "invalid";
    m.exactLabel = raw.exactLabel.trim();
  }
  if (raw.labelContains !== undefined) {
    if (typeof raw.labelContains !== "string" || !raw.labelContains.trim()) return "invalid";
    m.labelContains = raw.labelContains.trim();
  }
  if (raw.minScore !== undefined) {
    if (typeof raw.minScore !== "number" || !Number.isFinite(raw.minScore)) return "invalid";
    m.minScore = Math.min(1, Math.max(0, raw.minScore));
  }
  return Object.keys(m).length ? m : undefined;
}

function parseStep(raw: unknown): RecipeClickStep | null {
  if (!isPlainObject(raw)) return null;
  if (raw.action !== "click") return null;
  if (typeof raw.selector !== "string" || !raw.selector.trim()) return null;
  const match = parseMatch(raw.match);
  if (match === "invalid") return null;
  return {
    action: "click",
    selector: raw.selector.trim(),
    ...(match ? { match } : {}),
  };
}

/**
 * 校验并解析未知 JSON 为 `OperationRecipeV1`。
 */
export function parseRecipeJson(
  raw: unknown,
): { ok: true; recipe: OperationRecipeV1 } | { ok: false; message: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "recipe must be a JSON object" };
  }
  if (raw.schemaVersion !== OPERATION_RECIPE_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `unsupported schemaVersion (expected ${OPERATION_RECIPE_SCHEMA_VERSION})`,
    };
  }
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    return { ok: false, message: "id is required" };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, message: "name is required" };
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    return { ok: false, message: "steps must be a non-empty array" };
  }
  const steps: RecipeClickStep[] = [];
  for (let i = 0; i < raw.steps.length; i++) {
    const s = parseStep(raw.steps[i]);
    if (!s) {
      return {
        ok: false,
        message: `steps[${i}]: only action "click" with non-empty selector is supported; match must be valid`,
      };
    }
    steps.push(s);
  }
  const domFallback =
    raw.domFallback === undefined ? undefined : Boolean(raw.domFallback);
  const recipe: OperationRecipeV1 = {
    schemaVersion: OPERATION_RECIPE_SCHEMA_VERSION,
    id: raw.id.trim(),
    name: raw.name.trim(),
    ...(isPlainObject(raw.app) ? { app: raw.app as OperationRecipeV1["app"] } : {}),
    ...(domFallback !== undefined ? { domFallback } : {}),
    steps,
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
    ...(typeof raw.verifiedBuild === "string" ? { verifiedBuild: raw.verifiedBuild } : {}),
  };
  return { ok: true, recipe };
}
