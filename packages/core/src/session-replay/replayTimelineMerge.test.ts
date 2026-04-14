import { describe, expect, it } from "vitest";
import { compareReplayMergeOrder, parseReplayMergeKeyFromLine } from "./replayTimelineMerge.js";

describe("compareReplayMergeOrder", () => {
  it("sorts by mergeTs then targetId then seq", () => {
    const a = { mergeTs: 1, targetId: "b", seq: 2 };
    const b = { mergeTs: 1, targetId: "a", seq: 99 };
    expect(compareReplayMergeOrder(a, b)).toBeGreaterThan(0);
    expect(compareReplayMergeOrder(b, a)).toBeLessThan(0);
    const c = { mergeTs: 1, targetId: "a", seq: 1 };
    const d = { mergeTs: 1, targetId: "a", seq: 2 };
    expect(compareReplayMergeOrder(c, d)).toBeLessThan(0);
    const e = { mergeTs: 0, targetId: "z", seq: 999 };
    const f = { mergeTs: 1, targetId: "a", seq: 0 };
    expect(compareReplayMergeOrder(e, f)).toBeLessThan(0);
  });

  it("is deterministic for same triple", () => {
    const x = { mergeTs: 5, targetId: "t", seq: 1 };
    expect(compareReplayMergeOrder(x, x)).toBe(0);
  });
});

describe("parseReplayMergeKeyFromLine", () => {
  it("parses NDJSON with merge fields", () => {
    const line = JSON.stringify({
      type: "click",
      mergeTs: 10,
      targetId: "T1",
      seq: 3,
    });
    expect(parseReplayMergeKeyFromLine(line)).toEqual({ mergeTs: 10, targetId: "T1", seq: 3 });
  });

  it("returns null when fields missing", () => {
    expect(parseReplayMergeKeyFromLine("{}")).toBeNull();
    expect(parseReplayMergeKeyFromLine("not-json")).toBeNull();
  });
});
