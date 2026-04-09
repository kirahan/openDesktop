import { describe, expect, it } from "vitest";
import type { DomExploreCandidate } from "../cdp/domExplore.js";
import { pickUniqueCandidate } from "./pickCandidate.js";

const mk = (label: string, selector: string, score: number): DomExploreCandidate => ({
  label,
  selector,
  score,
  reasons: [],
});

describe("pickUniqueCandidate", () => {
  it("returns single after labelContains filter", () => {
    const cands = [mk("首页", "a", 0.9), mk("文档", "b", 0.85)];
    const r = pickUniqueCandidate(cands, { labelContains: "文档" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selector).toBe("b");
  });

  it("returns ambiguous when multiple match", () => {
    const cands = [mk("文档A", "a", 0.9), mk("文档B", "b", 0.85)];
    const r = pickUniqueCandidate(cands, { labelContains: "文档" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ambiguous");
  });

  it("returns no_match when none", () => {
    const r = pickUniqueCandidate([mk("x", "a", 0.9)], { labelContains: "zzz" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_match");
  });

  it("when exactLabel ties, prefers tab-surface heuristic", () => {
    const cands = [
      mk("文档", "menu-doc", 0.82),
      { label: "文档", selector: "tab-doc", score: 0.82, reasons: ["class:tab-surface"] },
    ];
    const r = pickUniqueCandidate(cands, { exactLabel: "文档" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selector).toBe("tab-doc");
  });

  it("exactLabel disambiguates 智能文档 vs 文档", () => {
    const cands = [mk("智能文档", "a", 0.9), mk("文档", "b", 0.88)];
    const sub = pickUniqueCandidate(cands, { labelContains: "文档" });
    expect(sub.ok).toBe(false);
    const ex = pickUniqueCandidate(cands, { exactLabel: "文档" });
    expect(ex.ok).toBe(true);
    if (ex.ok) expect(ex.selector).toBe("b");
  });
});
