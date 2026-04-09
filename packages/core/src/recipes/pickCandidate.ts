import type { DomExploreCandidate } from "../cdp/domExplore.js";
import type { RecipeDomMatch } from "./types.js";

export type PickCandidateResult =
  | { ok: true; selector: string }
  | { ok: false; reason: "no_match" | "ambiguous"; detail?: string };

/**
 * 从 DOM 探索候选中按 `match` 规则唯一选定 selector。
 */
export function pickUniqueCandidate(
  candidates: DomExploreCandidate[],
  match: RecipeDomMatch | undefined,
): PickCandidateResult {
  let list = [...candidates];
  if (match?.minScore !== undefined) {
    list = list.filter((c) => c.score >= match.minScore!);
  }
  if (match?.exactLabel) {
    const want = match.exactLabel.trim();
    list = list.filter((c) => c.label.trim() === want);
  } else if (match?.labelContains) {
    const sub = match.labelContains.toLowerCase();
    list = list.filter((c) => c.label.toLowerCase().includes(sub));
  }
  if (list.length === 0) {
    return { ok: false, reason: "no_match" };
  }
  if (list.length === 1) {
    return { ok: true, selector: list[0].selector };
  }
  if (!match?.exactLabel) {
    return {
      ok: false,
      reason: "ambiguous",
      detail: `${list.length} candidates after filters`,
    };
  }
  /** `exactLabel` 多条：优先最高分；同分则优先顶栏 Tab 启发式（避免与侧栏「文档」菜单标题冲突） */
  list.sort((a, b) => b.score - a.score);
  const max = list[0].score;
  const top = list.filter((c) => c.score === max);
  if (top.length === 1) {
    return { ok: true, selector: top[0].selector };
  }
  const tabLike = top.find(
    (c) =>
      c.reasons.some((r) => r.includes("class:tab-surface") || r.includes("role:tab")) ||
      c.selector.includes("tab-label") ||
      c.selector.includes("tab-item-name"),
  );
  if (tabLike) {
    return { ok: true, selector: tabLike.selector };
  }
  return {
    ok: false,
    reason: "ambiguous",
    detail: `${list.length} candidates after filters`,
  };
}
